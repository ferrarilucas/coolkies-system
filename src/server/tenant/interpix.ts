export class InterPixApiError extends Error {
  readonly code: string;
  readonly requestId: string | null;

  constructor(code: string, message: string, requestId: string | null) {
    super(message);
    this.code = code;
    this.requestId = requestId;
  }
}

export type InterPixSubscriptionStatus =
  | "PENDING_AUTH"
  | "ACTIVE"
  | "PAST_DUE"
  | "SUSPENDED"
  | "CANCELED"
  | "AUTH_DENIED";

export type InterPixSubscription = {
  id: string;
  status: InterPixSubscriptionStatus;
  externalUserId: string;
  planCode: string;
  amount: string;
  nextDueDate: string;
  authorization?: { pixCopyPaste: string; url: string };
};

export type CreateSubscriptionInput = {
  externalUserId: string;
  planCode: string;
  amountCents: number;
  intervalMonths: number;
  firstDueDate: string;
  debtor: { taxId: string; name: string };
};

export function amountFromCents(cents: number): string {
  return (Math.round(cents) / 100).toFixed(2);
}

function config(): { url: string; token: string } {
  const url = process.env.INTERPIX_API_URL;
  const token = process.env.INTERPIX_API_TOKEN;
  if (!url) throw new Error("INTERPIX_API_URL não configurada");
  if (!token) throw new Error("INTERPIX_API_TOKEN não configurada");
  return { url: url.replace(/\/$/, ""), token };
}

type ErrorBody = { code?: string; message?: string };

async function request<T>(
  path: string,
  init: RequestInit,
  okStatuses: number[],
): Promise<{ body: T | null; status: number; requestId: string | null }> {
  const { url, token } = config();

  const response = await fetch(`${url}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  const requestId = response.headers.get("X-Request-Id");
  const text = await response.text();

  console.info("interpix", path, response.status, requestId);

  let parsed: (T & ErrorBody) | null;
  try {
    parsed = text ? (JSON.parse(text) as T & ErrorBody) : null;
  } catch {
    throw new InterPixApiError(
      "INTERNAL_ERROR",
      `InterPix respondeu ${response.status} com corpo que não é JSON`,
      requestId,
    );
  }

  if (!okStatuses.includes(response.status)) {
    throw new InterPixApiError(
      parsed?.code ?? "INTERNAL_ERROR",
      parsed?.message ?? `InterPix respondeu ${response.status}`,
      requestId,
    );
  }

  return { body: parsed, status: response.status, requestId };
}

export async function createInterPixSubscription(
  input: CreateSubscriptionInput,
): Promise<InterPixSubscription> {
  const { body } = await request<InterPixSubscription>(
    "/subscriptions",
    {
      method: "POST",
      body: JSON.stringify({
        externalUserId: input.externalUserId,
        planCode: input.planCode,
        amount: amountFromCents(input.amountCents),
        intervalMonths: input.intervalMonths,
        firstDueDate: input.firstDueDate,
        debtor: input.debtor,
      }),
    },
    [200, 201],
  );

  if (!body) throw new InterPixApiError("INTERNAL_ERROR", "Resposta vazia da InterPix", null);
  return body;
}

export async function getInterPixSubscription(id: string): Promise<InterPixSubscription> {
  const { body } = await request<InterPixSubscription>(
    `/subscriptions/${encodeURIComponent(id)}`,
    { method: "GET" },
    [200],
  );

  if (!body) throw new InterPixApiError("INTERNAL_ERROR", "Resposta vazia da InterPix", null);
  return body;
}

export async function cancelInterPixSubscription(id: string): Promise<void> {
  await request(`/subscriptions/${encodeURIComponent(id)}/cancel`, { method: "POST" }, [200, 409]);
}
