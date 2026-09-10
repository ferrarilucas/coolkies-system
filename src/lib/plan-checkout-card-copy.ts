import type { CheckoutViewState } from "./checkout-state";

export type PlanCheckoutCardCopy = {
  title: string;
  description: string;
};

export function planCheckoutCardCopy(kind: CheckoutViewState["kind"]): PlanCheckoutCardCopy {
  switch (kind) {
    case "authorize":
      return {
        title: "Autorização pendente",
        description: "Você ainda não autorizou o débito recorrente deste plano.",
      };
    case "waiting":
      return {
        title: "Aguardando 1ª cobrança",
        description: "Sua autorização foi recebida — falta debitar a primeira cobrança.",
      };
    case "expired":
      return {
        title: "Prazo vencido",
        description: "O prazo passou sem confirmação de pagamento.",
      };
    case "failed":
      return {
        title: "Cobrança não gerada",
        description: "Não foi possível gerar a cobrança Pix para este plano.",
      };
    case "none":
      return { title: "", description: "" };
  }
}

type CheckoutKind = CheckoutViewState["kind"];

export const PENDING_AUTH_BADGE_LABEL: Partial<Record<CheckoutKind, string>> = {
  authorize: "Autorização pendente",
  waiting: "Aguardando 1ª cobrança",
  expired: "Prazo vencido",
  failed: "Cobrança não gerada",
};

export const PENDING_AUTH_BUTTON_LABEL: Partial<Record<CheckoutKind, string>> = {
  authorize: "Autorização pendente acima",
  waiting: "Aguardando cobrança acima",
  failed: "Tentar novamente acima",
};
