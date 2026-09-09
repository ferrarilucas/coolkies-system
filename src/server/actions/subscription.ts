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
import {
  getBillingUser,
  getSubscription,
  recordInterPixSubscription,
} from "@/server/tenant/subscription";
import {
  cancelInterPixSubscription,
  createInterPixSubscription,
  InterPixApiError,
} from "@/server/tenant/interpix";

export type ActionResult<T = undefined> = { ok: boolean; error?: string; data?: T };

export type CheckoutResult = { pixCopyPaste: string; nextDueDate: string };

const CHARGE_LEAD_DAYS = 3;

const GENERIC_ERROR =
  "Não foi possível concluir a contratação agora. Tente novamente em instantes.";

const MANUAL_ERROR =
  "Sua assinatura foi combinada manualmente com a nossa equipe e não pode ser alterada por aqui. Fale com a gente para mudar de plano.";

const PLAN_CHANGE_ERROR =
  "Você já tem uma assinatura ativa. Para mudar de plano, fale com a nossa equipe.";

const LIVE_STATUSES = new Set(["ACTIVE", "PAST_DUE"]);

function firstDueDate(trialEndsAt: Date | null, now: Date = new Date()): string {
  const minimo = new Date(now);
  minimo.setDate(minimo.getDate() + CHARGE_LEAD_DAYS);
  const escolhida = trialEndsAt && trialEndsAt > minimo ? trialEndsAt : minimo;
  return escolhida.toISOString().slice(0, 10);
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

  try {
    const { userId } = await getWorkspaceContext();
    const existing = await getSubscription(userId);

    if (existing?.provider === "MANUAL") {
      return { ok: false, error: MANUAL_ERROR };
    }

    if (existing?.interpixSubscriptionId && LIVE_STATUSES.has(existing.status)) {
      return { ok: false, error: PLAN_CHANGE_ERROR };
    }

    if (
      existing?.interpixSubscriptionId &&
      existing.plan === plan &&
      existing.cycle === cycle
    ) {
      return {
        ok: false,
        error: `Você já tem uma assinatura ${planLabel(plan)} em andamento.`,
      };
    }

    if (existing?.interpixSubscriptionId) {
      try {
        await cancelInterPixSubscription(existing.interpixSubscriptionId);
      } catch (e) {
        console.error(
          "subscribe: falha ao cancelar mandato antigo",
          existing.interpixSubscriptionId,
          e,
        );
        return { ok: false, error: GENERIC_ERROR };
      }
    }

    const user = await getBillingUser(userId);
    if (!user) return { ok: false, error: "Usuário não encontrado." };

    const remote = await createInterPixSubscription({
      externalUserId: userId,
      planCode: plan,
      amountCents,
      intervalMonths: cycle === "YEARLY" ? 12 : 1,
      firstDueDate: firstDueDate(existing?.trialEndsAt ?? null),
      debtor: { taxId, name: user.name },
    });

    const pixCopyPaste = remote.authorization?.pixCopyPaste ?? null;

    await recordInterPixSubscription({
      userId,
      plan,
      cycle,
      interpixSubscriptionId: remote.id,
      pixCopyPaste,
      nextDueDate: new Date(`${remote.nextDueDate}T00:00:00.000Z`),
    });

    revalidatePath("/", "layout");

    if (!pixCopyPaste) {
      console.error("subscribe: assinatura criada sem copia-e-cola", remote.id);
      return { ok: false, error: GENERIC_ERROR };
    }

    return { ok: true, data: { pixCopyPaste, nextDueDate: remote.nextDueDate } };
  } catch (e) {
    if (e instanceof InterPixApiError && e.code === "BAD_REQUEST") {
      return { ok: false, error: e.message };
    }
    console.error("subscribe: falha ao contratar", e);
    return { ok: false, error: GENERIC_ERROR };
  }
}

export async function resumeCheckout(): Promise<ActionResult<CheckoutResult>> {
  try {
    const { userId } = await getWorkspaceContext();
    const existing = await getSubscription(userId);

    if (!existing?.interpixSubscriptionId || !existing.interpixPixCopyPaste) {
      return { ok: false, error: "Nenhuma autorização pendente." };
    }

    return {
      ok: true,
      data: {
        pixCopyPaste: existing.interpixPixCopyPaste,
        nextDueDate: existing.currentPeriodEnd
          ? existing.currentPeriodEnd.toISOString().slice(0, 10)
          : "",
      },
    };
  } catch (e) {
    console.error("resumeCheckout: falha ao recuperar autorização", e);
    return { ok: false, error: GENERIC_ERROR };
  }
}
