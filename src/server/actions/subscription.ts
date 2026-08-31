"use server";

import { revalidatePath } from "next/cache";
import { planPriceCents, type PlanCycle } from "@/lib/plans";
import { getWorkspaceContext } from "@/server/tenant/context";
import {
  getBillingUser,
  getSubscription,
  recordAsaasSubscription,
} from "@/server/tenant/subscription";
import {
  brlFromCents,
  createAsaasCustomer,
  createAsaasSubscription,
} from "@/server/tenant/asaas";

export type ActionResult<T = undefined> = { ok: boolean; error?: string; data?: T };

export async function subscribe(formData: FormData): Promise<ActionResult> {
  const plan = String(formData.get("plan") ?? "solo");
  const cycle = String(formData.get("cycle") ?? "MONTHLY") as PlanCycle;
  const cpfCnpj = String(formData.get("cpfCnpj") ?? "").replace(/\D/g, "");

  const priceCents = planPriceCents(plan, cycle);
  if (priceCents === null) {
    return { ok: false, error: "Este plano é contratado por atendimento." };
  }
  if (cpfCnpj.length !== 11 && cpfCnpj.length !== 14) {
    return { ok: false, error: "Informe um CPF ou CNPJ válido." };
  }

  try {
    const { userId } = await getWorkspaceContext();
    const user = await getBillingUser(userId);
    if (!user) return { ok: false, error: "Usuário não encontrado." };

    const existing = await getSubscription(userId);

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
      asaasCustomerId: customerId,
      asaasSubscriptionId: remote.id,
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Falha na contratação." };
  }

  revalidatePath("/", "layout");
  return { ok: true };
}
