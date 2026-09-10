export type PlanBannerText = {
  headline: string;
  body: string | null;
  cta: string | null;
};

const INFRA_FAILURE_REASONS = new Set([
  "JANELA_DE_ENVIO_EXPIRADA",
  "SEM_CONFIRMACAO_DO_PROVEDOR",
]);

export function readOnlyBannerText(
  status: string,
  hasAuthorized: boolean,
): PlanBannerText {
  switch (status) {
    case "PAST_DUE":
      return {
        headline: "Pagamento pendente — o cadastro está em modo somente leitura.",
        body: null,
        cta: "Regularizar assinatura",
      };
    case "TRIALING":
      return {
        headline: "O teste terminou — o cadastro está em modo somente leitura.",
        body: null,
        cta: "Assinar um plano",
      };
    case "NONE":
      return {
        headline: "Nenhum plano ativo — o cadastro está em modo somente leitura.",
        body: null,
        cta: "Assinar um plano",
      };
    case "PENDING_AUTH":
      if (!hasAuthorized) {
        return {
          headline:
            "O teste terminou sem que o débito recorrente fosse autorizado — o cadastro está em modo somente leitura.",
          body: null,
          cta: "Assinar um plano",
        };
      }
      return {
        headline:
          "O prazo passou sem confirmação de pagamento — o cadastro está em modo somente leitura.",
        body: null,
        cta: "Assinar um plano",
      };
    case "SUSPENDED":
      return {
        headline:
          "Assinatura suspensa por falta de pagamento — o cadastro está em modo somente leitura.",
        body: null,
        cta: "Assinar um plano",
      };
    case "AUTH_DENIED":
      return {
        headline:
          "Seu banco recusou a autorização do débito recorrente — o cadastro está em modo somente leitura.",
        body: null,
        cta: "Assinar um plano",
      };
    default:
      return {
        headline: "Assinatura cancelada — o cadastro está em modo somente leitura.",
        body: null,
        cta: "Assinar um plano",
      };
  }
}

export function activeBannerText(
  status: string,
  hasAuthorized: boolean,
  lastFailureReason: string | null,
): PlanBannerText | null {
  if (status === "PAST_DUE") {
    if (lastFailureReason && INFRA_FAILURE_REASONS.has(lastFailureReason)) {
      return {
        headline: "Falha técnica na última cobrança.",
        body: "A última tentativa de cobrança não chegou a ser confirmada por uma falha técnica no envio, não por falta de pagamento. A InterPix vai tentar novamente e o cadastro continua liberado.",
        cta: null,
      };
    }
    return {
      headline: "Pagamento pendente.",
      body: "A InterPix está tentando cobrar novamente. O cadastro continua liberado enquanto isso, mas regularize para evitar a suspensão.",
      cta: "Regularizar assinatura",
    };
  }

  if (status === "PENDING_AUTH") {
    if (!hasAuthorized) {
      return {
        headline: "Aguardando autorização do débito recorrente.",
        body: "O cadastro continua liberado, mas o plano só ativa depois que você autorizar o débito no app do banco e a primeira cobrança for debitada.",
        cta: "Ver detalhes da assinatura",
      };
    }
    return {
      headline: "Autorização recebida — aguardando a primeira cobrança.",
      body: "O plano ativa quando a primeira cobrança for debitada. Isso pode levar alguns dias e o cadastro continua liberado até lá.",
      cta: null,
    };
  }

  return null;
}
