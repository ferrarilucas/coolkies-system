"use server";

import { revalidatePath } from "next/cache";
import { isKnownCycle, isKnownPlan, planLabel, planPriceCents, type PlanCycle } from "@/lib/plans";
import { getWorkspaceContext } from "@/server/tenant/context";
import {
  getBillingUser,
  getSubscription,
  recordAsaasSubscription,
} from "@/server/tenant/subscription";
import {
  AsaasApiError,
  brlFromCents,
  createAsaasCustomer,
  createAsaasSubscription,
} from "@/server/tenant/asaas";

export type ActionResult<T = undefined> = { ok: boolean; error?: string; data?: T };

const CYCLE_LABEL: Record<PlanCycle, string> = {
  MONTHLY: "mensal",
  YEARLY: "anual",
};

const GENERIC_ERROR = "Não foi possível concluir a contratação agora. Tente novamente em instantes.";

const MANUAL_SUBSCRIPTION_ERROR =
  "Sua assinatura foi combinada manualmente com a equipe Coolkies e não pode ser alterada por aqui. Fale com a gente em contato@coolkies.com.br para mudar de plano.";

export async function subscribe(formData: FormData): Promise<ActionResult> {
  const plan = String(formData.get("plan") ?? "");
  const rawCycle = String(formData.get("cycle") ?? "MONTHLY");
  const cpfCnpj = String(formData.get("cpfCnpj") ?? "").replace(/\D/g, "");
  const confirmSwitch = formData.get("confirmSwitch") === "true";

  if (!isKnownPlan(plan)) {
    return { ok: false, error: "Plano inválido." };
  }
  if (!isKnownCycle(rawCycle)) {
    return { ok: false, error: "Ciclo de cobrança inválido." };
  }
  const cycle: PlanCycle = rawCycle;

  const priceCents = planPriceCents(plan, cycle);
  if (priceCents === null) {
    return { ok: false, error: "Este plano é contratado por atendimento." };
  }
  if (cpfCnpj.length !== 11 && cpfCnpj.length !== 14) {
    return { ok: false, error: "Informe um CPF ou CNPJ válido." };
  }

  try {
    const { userId } = await getWorkspaceContext();
    const existing = await getSubscription(userId);

    if (existing?.source === "MANUAL") {
      return { ok: false, error: MANUAL_SUBSCRIPTION_ERROR };
    }

    const user = await getBillingUser(userId);
    if (!user) return { ok: false, error: "Usuário não encontrado." };

    if (existing?.asaasSubscriptionId) {
      const samePlanAndCycle = existing.plan === plan && existing.cycle === cycle;
      if (samePlanAndCycle) {
        return {
          ok: false,
          error: `Você já tem uma assinatura ativa no plano ${planLabel(plan)} (${CYCLE_LABEL[cycle]}).`,
        };
      }
      if (!confirmSwitch) {
        return {
          ok: false,
          error: `Você já tem uma assinatura no plano ${planLabel(existing.plan)} (${CYCLE_LABEL[existing.cycle]}). Confirme a troca para o plano ${planLabel(plan)} (${CYCLE_LABEL[cycle]}) para continuar.`,
        };
      }
    }

    const customerId =
      existing?.asaasCustomerId ??
      (await createAsaasCustomer({ name: user.name, email: user.email, cpfCnpj })).id;

    const value = cycle === "YEARLY" ? brlFromCents(priceCents * 12) : brlFromCents(priceCents);

    const remote = await createAsaasSubscription({
      customer: customerId,
      billingType: "PIX",
      value,
      nextDueDate: new Date().toISOString().slice(0, 10),
      cycle,
      description: `Coolkies — plano ${plan}`,
    });

    await recordAsaasSubscription({
      userId,
      plan,
      cycle,
      asaasCustomerId: customerId,
      asaasSubscriptionId: remote.id,
    });
  } catch (e) {
    if (e instanceof AsaasApiError) {
      return { ok: false, error: e.message };
    }
    console.error("subscribe: falha ao contratar assinatura", e);
    return { ok: false, error: GENERIC_ERROR };
  }

  revalidatePath("/", "layout");
  return { ok: true };
}
