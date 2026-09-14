"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { loadStripe, type Stripe, type Appearance } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  subscribeWithCard,
  type PendingChargeWarning,
} from "@/server/actions/subscription";
import { formatDueDate } from "@/components/checkout/pix-checkout-content";

const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

let stripePromise: Promise<Stripe | null> | null = null;
function getStripe(): Promise<Stripe | null> {
  if (!publishableKey) return Promise.resolve(null);
  if (!stripePromise) stripePromise = loadStripe(publishableKey);
  return stripePromise;
}

const APPEARANCE_BY_THEME: Record<"light" | "dark", Appearance> = {
  light: {
    theme: "stripe",
    variables: {
      colorPrimary: "hsl(25 45% 38%)",
      colorBackground: "hsl(0 0% 100%)",
      colorText: "hsl(25 30% 15%)",
      colorTextSecondary: "hsl(25 12% 42%)",
      colorTextPlaceholder: "hsl(25 12% 42%)",
      colorDanger: "hsl(0 72% 48%)",
      fontFamily: "inherit",
      borderRadius: "8px",
    },
    rules: {
      ".Input": { border: "1px solid hsl(30 20% 86%)", boxShadow: "none" },
      ".Input:focus": { border: "1px solid hsl(25 45% 38%)", boxShadow: "none" },
      ".Tab": { border: "1px solid hsl(30 20% 86%)" },
      ".Tab:hover": { border: "1px solid hsl(25 45% 38%)" },
      ".Tab--selected": {
        border: "1px solid hsl(25 45% 38%)",
        boxShadow: "none",
      },
    },
  },
  dark: {
    theme: "night",
    variables: {
      colorPrimary: "hsl(25 50% 55%)",
      colorBackground: "hsl(25 16% 13%)",
      colorText: "hsl(36 30% 94%)",
      colorTextSecondary: "hsl(33 12% 65%)",
      colorTextPlaceholder: "hsl(33 12% 65%)",
      colorDanger: "hsl(0 62% 45%)",
      fontFamily: "inherit",
      borderRadius: "8px",
    },
    rules: {
      ".Input": { border: "1px solid hsl(25 12% 24%)", boxShadow: "none" },
      ".Input:focus": { border: "1px solid hsl(25 50% 55%)", boxShadow: "none" },
      ".Tab": { border: "1px solid hsl(25 12% 24%)" },
      ".Tab:hover": { border: "1px solid hsl(25 50% 55%)" },
      ".Tab--selected": {
        border: "1px solid hsl(25 50% 55%)",
        boxShadow: "none",
      },
    },
  },
};

function useElementsAppearance(): Appearance {
  const { resolvedTheme } = useTheme();
  return APPEARANCE_BY_THEME[resolvedTheme === "dark" ? "dark" : "light"];
}

function PendingChargeNotice({ charge }: { charge: PendingChargeWarning }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
      <p className="text-warning">
        Uma cobrança da sua assinatura Pix anterior já foi enviada ao banco e
        será debitada em {formatDueDate(charge.dueDate)} mesmo com o
        cancelamento — regra do Banco Central.
      </p>
    </div>
  );
}

function CardForm({ plan, cycle }: { plan: string; cycle: string }) {
  const stripe = useStripe();
  const elements = useElements();
  const router = useRouter();
  const appearance = useElementsAppearance();
  const [submitting, setSubmitting] = useState(false);
  const [pendingCharge, setPendingCharge] = useState<PendingChargeWarning | null>(
    null,
  );

  useEffect(() => {
    elements?.update({ appearance });
  }, [elements, appearance]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!stripe || !elements || submitting) return;
    setSubmitting(true);

    const submitResult = await elements.submit();
    if (submitResult.error) {
      toast.error(submitResult.error.message ?? "Confira os dados do cartão.");
      setSubmitting(false);
      return;
    }

    const formData = new FormData();
    formData.set("plan", plan);
    formData.set("cycle", cycle);
    const res = await subscribeWithCard(formData);
    if (!res.ok || !res.data) {
      toast.error(res.error ?? "Não foi possível iniciar a assinatura.");
      setSubmitting(false);
      return;
    }

    setPendingCharge(res.data.previousPendingCharge);
    const returnUrl = `${window.location.origin}/workspaces/plan`;
    const confirm =
      res.data.mode === "setup"
        ? stripe.confirmSetup({
            elements,
            clientSecret: res.data.clientSecret,
            confirmParams: { return_url: returnUrl },
            redirect: "if_required",
          })
        : stripe.confirmPayment({
            elements,
            clientSecret: res.data.clientSecret,
            confirmParams: { return_url: returnUrl },
            redirect: "if_required",
          });

    const { error } = await confirm;
    if (error) {
      toast.error(error.message ?? "Não foi possível confirmar o cartão.");
      setSubmitting(false);
      return;
    }

    toast.success("Cartão confirmado. Sua assinatura está ativa.");
    router.push("/workspaces/plan");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {pendingCharge && <PendingChargeNotice charge={pendingCharge} />}
      <PaymentElement options={{ layout: "tabs" }} />
      <Button type="submit" className="w-full" disabled={!stripe || submitting}>
        {submitting ? "Confirmando..." : "Confirmar assinatura"}
      </Button>
      <p className="text-xs text-muted-foreground">
        Seus dados de cartão são processados pela Stripe e não passam pelos
        nossos servidores.
      </p>
    </form>
  );
}

export function CardCheckoutContent({
  plan,
  cycle,
  monthlyCents,
}: {
  plan: string;
  cycle: string;
  monthlyCents: number;
}) {
  const stripe = useMemo(() => getStripe(), []);
  const appearance = useElementsAppearance();

  if (!publishableKey) {
    return (
      <p className="text-sm text-muted-foreground">
        O pagamento com cartão ainda não está disponível.
      </p>
    );
  }

  return (
    <Elements
      stripe={stripe}
      options={{
        mode: "subscription",
        amount: monthlyCents,
        currency: "brl",
        appearance,
      }}
    >
      <CardForm plan={plan} cycle={cycle} />
    </Elements>
  );
}
