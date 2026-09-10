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
import type { Subscription } from "@prisma/client";
import {
  getBillingUser,
  getSubscription,
  recordInterPixSubscription,
  recordPendingChargeWarning,
  recordUserCpf,
} from "@/server/tenant/subscription";
import {
  cancelInterPixSubscription,
  createInterPixSubscription,
  InterPixApiError,
  type InterPixSubscription,
} from "@/server/tenant/interpix";

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
