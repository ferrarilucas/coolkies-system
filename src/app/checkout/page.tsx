import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import {
  chargeAmountCents,
  isKnownCycle,
  isKnownPlan,
  monthlyPriceCents,
  planLabel,
  planWorkspacesLabel,
  type PlanCycle,
} from "@/lib/plans";
import { getWorkspaceContext } from "@/server/tenant/context";
import { getBillingUser, getSubscription } from "@/server/tenant/subscription";
import { CheckoutClient } from "@/components/checkout/checkout-client";

export const metadata = {
  title: "Finalizar assinatura — Coolkies",
};

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; cycle?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const { plan, cycle: rawCycle } = await searchParams;

  if (!plan || !isKnownPlan(plan)) redirect("/workspaces/plan");
  const cycle: PlanCycle =
    rawCycle && isKnownCycle(rawCycle) ? rawCycle : "MONTHLY";

  const monthlyCents = monthlyPriceCents(plan, cycle, "PIX");
  const totalCents = chargeAmountCents(plan, cycle, "PIX");
  if (monthlyCents === null || totalCents === null) redirect("/workspaces/plan");

  const { userId } = await getWorkspaceContext();
  const [sub, user] = await Promise.all([
    getSubscription(userId),
    getBillingUser(userId),
  ]);
  if (sub?.provider === "MANUAL") redirect("/workspaces/plan");

  return (
    <CheckoutClient
      plan={plan}
      cycle={cycle}
      planName={planLabel(plan)}
      workspacesLabel={planWorkspacesLabel(plan)}
      monthlyCents={monthlyCents}
      totalCents={totalCents}
      defaultCpf={user?.cpf ?? null}
    />
  );
}
