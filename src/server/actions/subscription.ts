"use server";

import { revalidatePath } from "next/cache";
import {
  chargeAmountCents,
  isKnownCycle,
  isKnownPlan,
  planLabel,
  type PlanCycle,
} from "@/lib/plans";
import { getWorkspaceContext } from "@/server/tenant/context";
import { isValidIsoCalendarDate } from "@/lib/date-validation";
import { isPeriodPaid } from "@/lib/period";
import type { Subscription } from "@prisma/client";
import {
  getBillingUser,
  getSubscription,
  recordInterPixSubscription,
  recordPendingChargeWarning,
  recordStripeSubscription,
  recordUserCpf,
} from "@/server/tenant/subscription";
import {
  cancelInterPixSubscription,
  createInterPixSubscription,
  InterPixApiError,
  type InterPixSubscription,
} from "@/server/tenant/interpix";
import {
  createHostedCheckoutSession,
  createStripeSubscription,
  getOrCreateStripeCustomer,
  priceIdFor,
  StripeConfigError,
  type StripeSubscriptionMode,
} from "@/server/tenant/stripe";

export type ActionResult<T = undefined> = { ok: boolean; error?: string; data?: T };

export type PendingChargeWarning = { cycleSeq: number; dueDate: string };

export type CheckoutResult = {
  pixCopyPaste: string;
  nextDueDate: string;
  previousPendingCharge: PendingChargeWarning | null;
};

const CHARGE_LEAD_DAYS = 3;

const GENERIC_ERROR =
  "Não foi possível concluir a contratação agora. Tente novamente em instantes.";

const VALIDATION_ERROR =
  "Não foi possível confirmar os dados enviados. Confira o CPF/CNPJ e tente novamente.";

const MANUAL_ERROR =
  "Sua assinatura foi combinada manualmente com a nossa equipe e não pode ser alterada por aqui. Fale com a gente para mudar de plano.";

const PLAN_CHANGE_ERROR =
  "Você já tem uma assinatura ativa. Para mudar de plano, fale com a nossa equipe.";

const LIVE_STATUSES = new Set(["ACTIVE", "PAST_DUE"]);

function isLiveMandate(sub: Subscription, now: Date = new Date()): boolean {
  if (LIVE_STATUSES.has(sub.status)) return true;
  return (
    sub.status === "PENDING_AUTH" && sub.graceUntil !== null && sub.graceUntil > now
  );
}

function firstDueDate(trialEndsAt: Date | null, now: Date = new Date()): string {
  const minimumDueDate = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + CHARGE_LEAD_DAYS),
  );
  const chosenDueDate =
    trialEndsAt && trialEndsAt > minimumDueDate ? trialEndsAt : minimumDueDate;
  return chosenDueDate.toISOString().slice(0, 10);
}

export async function subscribe(
  formData: FormData,
): Promise<ActionResult<CheckoutResult>> {
  const plan = String(formData.get("plan") ?? "");
  const rawCycle = String(formData.get("cycle") ?? "MONTHLY");
  const taxId = String(formData.get("cpfCnpj") ?? "").replace(/\D/g, "");

  if (!isKnownPlan(plan)) return { ok: false, error: "Plano inválido." };
  if (!isKnownCycle(rawCycle)) return { ok: false, error: "Ciclo de cobrança inválido." };
  const cycle: PlanCycle = rawCycle;

  const amountCents = chargeAmountCents(plan, cycle, "PIX");
  if (amountCents === null) {
    return { ok: false, error: "Este plano é contratado por atendimento." };
  }
  if (taxId.length !== 11 && taxId.length !== 14) {
    return { ok: false, error: "Informe um CPF ou CNPJ válido." };
  }

  let remote: InterPixSubscription | undefined;
  let previousPendingCharge: PendingChargeWarning | null = null;

  try {
    const { userId } = await getWorkspaceContext();
    const existing = await getSubscription(userId);

    if (existing?.provider === "MANUAL") {
      return { ok: false, error: MANUAL_ERROR };
    }

    if (existing?.interpixSubscriptionId && isLiveMandate(existing)) {
      return { ok: false, error: PLAN_CHANGE_ERROR };
    }

    if (
      existing?.status === "PENDING_AUTH" &&
      existing.graceUntil === null &&
      existing.interpixPixCopyPaste &&
      existing.plan === plan &&
      existing.cycle === cycle
    ) {
      return {
        ok: false,
        error: `Você já tem uma assinatura ${planLabel(plan)} em andamento.`,
      };
    }

    const user = await getBillingUser(userId);
    if (!user) return { ok: false, error: "Usuário não encontrado." };

    if (existing?.interpixSubscriptionId) {
      try {
        const cancelResult = await cancelInterPixSubscription(existing.interpixSubscriptionId);
        if (cancelResult.pendingCycle) {
          if (isValidIsoCalendarDate(cancelResult.pendingCycle.dueDate)) {
            previousPendingCharge = {
              cycleSeq: cancelResult.pendingCycle.cycleSeq,
              dueDate: cancelResult.pendingCycle.dueDate,
            };
            await recordPendingChargeWarning(
              userId,
              new Date(`${cancelResult.pendingCycle.dueDate}T00:00:00.000Z`),
            );
          } else {
            console.error(
              "subscribe: vencimento da cobrança pendente inválido",
              cancelResult.pendingCycle.dueDate,
            );
          }
        }
      } catch (e) {
        if (e instanceof InterPixApiError) {
          console.error(
            "subscribe: falha ao cancelar mandato antigo",
            existing.interpixSubscriptionId,
            e.code,
            e.requestId,
          );
        } else {
          console.error(
            "subscribe: falha ao cancelar mandato antigo",
            existing.interpixSubscriptionId,
            e instanceof Error ? e.name : "erro desconhecido",
          );
        }
        return { ok: false, error: GENERIC_ERROR };
      }
    }

    remote = await createInterPixSubscription({
      externalUserId: userId,
      planCode: plan,
      amountCents,
      intervalMonths: cycle === "YEARLY" ? 12 : 1,
      firstDueDate: firstDueDate(existing?.trialEndsAt ?? null),
      debtor: { taxId, name: user.name },
    });

    if (!remote.id || !remote.nextDueDate) {
      console.error(
        "subscribe: resposta da InterPix sem id ou nextDueDate",
        remote.id ?? null,
      );
      return { ok: false, error: GENERIC_ERROR };
    }

    const pixCopyPaste = remote.authorization?.pixCopyPaste ?? null;

    await recordInterPixSubscription({
      userId,
      plan,
      cycle,
      interpixSubscriptionId: remote.id,
      pixCopyPaste,
      nextDueDate: new Date(`${remote.nextDueDate}T00:00:00.000Z`),
    });

    if (taxId.length === 11) {
      await recordUserCpf(userId, taxId);
    }

    revalidatePath("/", "layout");

    if (!pixCopyPaste) {
      console.error("subscribe: assinatura criada sem copia-e-cola", remote.id);
      return { ok: false, error: GENERIC_ERROR };
    }

    return {
      ok: true,
      data: { pixCopyPaste, nextDueDate: remote.nextDueDate, previousPendingCharge },
    };
  } catch (e) {
    if (e instanceof InterPixApiError && e.code === "BAD_REQUEST") {
      console.error("subscribe: InterPix rejeitou os dados enviados", e.code, e.requestId);
      return { ok: false, error: VALIDATION_ERROR };
    }
    if (e instanceof InterPixApiError) {
      console.error("subscribe: falha ao contratar", e.code, e.requestId);
    } else {
      console.error(
        "subscribe: falha ao contratar",
        e instanceof Error ? e.name : "erro desconhecido",
      );
    }
    return { ok: false, error: GENERIC_ERROR };
  }
}

export type CardCheckoutResult = {
  clientSecret: string;
  mode: StripeSubscriptionMode;
  previousPendingCharge: PendingChargeWarning | null;
};

const STRIPE_TRIAL_MIN_MS = 48 * 60 * 60 * 1000;

function stripeTrialEndSeconds(
  existing: Subscription | null,
  now: Date,
): number | undefined {
  const candidates: number[] = [];
  if (existing?.status === "TRIALING" && existing.trialEndsAt) {
    candidates.push(existing.trialEndsAt.getTime());
  }
  if (existing && isPeriodPaid(existing) && existing.currentPeriodEnd) {
    candidates.push(existing.currentPeriodEnd.getTime());
  }
  if (candidates.length === 0) return undefined;
  const furthest = Math.max(...candidates);
  if (furthest - now.getTime() < STRIPE_TRIAL_MIN_MS) return undefined;
  return Math.floor(furthest / 1000);
}

async function cancelExistingInterPixMandate(
  userId: string,
  existing: Subscription,
): Promise<PendingChargeWarning | null> {
  if (!existing.interpixSubscriptionId) return null;

  const cancelResult = await cancelInterPixSubscription(
    existing.interpixSubscriptionId,
  );
  if (!cancelResult.pendingCycle) return null;

  if (!isValidIsoCalendarDate(cancelResult.pendingCycle.dueDate)) {
    console.error(
      "subscribeWithCard: vencimento da cobrança pendente inválido",
      cancelResult.pendingCycle.dueDate,
    );
    return null;
  }

  await recordPendingChargeWarning(
    userId,
    new Date(`${cancelResult.pendingCycle.dueDate}T00:00:00.000Z`),
  );
  return {
    cycleSeq: cancelResult.pendingCycle.cycleSeq,
    dueDate: cancelResult.pendingCycle.dueDate,
  };
}

export async function subscribeWithCard(
  formData: FormData,
): Promise<ActionResult<CardCheckoutResult>> {
  const plan = String(formData.get("plan") ?? "");
  const rawCycle = String(formData.get("cycle") ?? "MONTHLY");

  if (!isKnownPlan(plan)) return { ok: false, error: "Plano inválido." };
  if (!isKnownCycle(rawCycle)) {
    return { ok: false, error: "Ciclo de cobrança inválido." };
  }
  const cycle: PlanCycle = rawCycle;

  if (chargeAmountCents(plan, cycle, "CARD") === null) {
    return { ok: false, error: "Este plano é contratado por atendimento." };
  }

  try {
    const { userId } = await getWorkspaceContext();
    const existing = await getSubscription(userId);

    if (existing?.provider === "MANUAL") {
      return { ok: false, error: MANUAL_ERROR };
    }

    const user = await getBillingUser(userId);
    if (!user) return { ok: false, error: "Usuário não encontrado." };

    let previousPendingCharge: PendingChargeWarning | null = null;
    if (existing?.interpixSubscriptionId) {
      try {
        previousPendingCharge = await cancelExistingInterPixMandate(userId, existing);
      } catch (e) {
        console.error(
          "subscribeWithCard: falha ao cancelar mandato InterPix",
          existing.interpixSubscriptionId,
          e instanceof InterPixApiError ? e.code : "erro desconhecido",
        );
        return { ok: false, error: GENERIC_ERROR };
      }
    }

    const now = new Date();
    const trialEnd = stripeTrialEndSeconds(existing, now);
    const mode: StripeSubscriptionMode = trialEnd ? "setup" : "payment";

    const customerId = await getOrCreateStripeCustomer({
      userId,
      email: user.email,
      name: user.name,
      existingCustomerId: existing?.stripeCustomerId ?? null,
    });

    const created = await createStripeSubscription({
      customerId,
      priceId: priceIdFor(plan, cycle),
      mode,
      trialEnd,
      idempotencyKey: `stripe-sub:${userId}:${plan}:${cycle}`,
      metadata: { userId, plan, cycle },
    });

    await recordStripeSubscription({
      userId,
      plan,
      cycle,
      stripeCustomerId: customerId,
      stripeSubscriptionId: created.subscriptionId,
    });

    revalidatePath("/", "layout");

    return {
      ok: true,
      data: { clientSecret: created.clientSecret, mode: created.mode, previousPendingCharge },
    };
  } catch (e) {
    if (e instanceof StripeConfigError) {
      console.error("subscribeWithCard: configuração Stripe ausente", e.message);
      return { ok: false, error: GENERIC_ERROR };
    }
    console.error(
      "subscribeWithCard: falha ao contratar",
      e instanceof Error ? e.name : "erro desconhecido",
    );
    return { ok: false, error: GENERIC_ERROR };
  }
}

export async function getStripeHostedCheckoutUrl(
  formData: FormData,
): Promise<ActionResult<{ url: string }>> {
  const plan = String(formData.get("plan") ?? "");
  const rawCycle = String(formData.get("cycle") ?? "MONTHLY");

  if (!isKnownPlan(plan)) return { ok: false, error: "Plano inválido." };
  if (!isKnownCycle(rawCycle)) {
    return { ok: false, error: "Ciclo de cobrança inválido." };
  }
  const cycle: PlanCycle = rawCycle;

  try {
    const { userId } = await getWorkspaceContext();
    const user = await getBillingUser(userId);
    if (!user) return { ok: false, error: "Usuário não encontrado." };

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const url = await createHostedCheckoutSession({
      priceId: priceIdFor(plan, cycle),
      customerEmail: user.email,
      successUrl: `${appUrl}/workspaces/plan?stripe_checkout=success`,
      cancelUrl: `${appUrl}/checkout?plan=${plan}&cycle=${cycle}`,
    });

    return { ok: true, data: { url } };
  } catch (e) {
    if (e instanceof StripeConfigError) {
      console.error("getStripeHostedCheckoutUrl: configuração Stripe ausente", e.message);
    } else {
      console.error(
        "getStripeHostedCheckoutUrl: falha ao criar checkout hospedado",
        e instanceof Error ? e.name : "erro desconhecido",
      );
    }
    return { ok: false, error: GENERIC_ERROR };
  }
}
