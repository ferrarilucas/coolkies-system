const SANDBOX = "https://api-sandbox.asaas.com/v3";
const PRODUCTION = "https://api.asaas.com/v3";

function baseUrl(): string {
  const env = process.env.ASAAS_ENV;
  if (env === "production") return PRODUCTION;
  if (env === "sandbox") return SANDBOX;
  throw new Error(
    `ASAAS_ENV precisa ser "production" ou "sandbox" — valor atual: ${env === undefined ? "ausente" : `"${env}"`}`,
  );
}

export function brlFromCents(cents: number): number {
  return Math.round(cents) / 100;
}

type AsaasError = { errors?: Array<{ description?: string }> };

export class AsaasApiError extends Error {}

export async function asaasFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const key = process.env.ASAAS_API_KEY;
  console.error(
    "DIAGNOSTICO TEMPORARIO asaasFetch: length=",
    key?.length,
    "inicio=",
    JSON.stringify(key?.slice(0, 4)),
  );
  if (!key) throw new Error("ASAAS_API_KEY não configurada");

  const response = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      access_token: key,
      "Content-Type": "application/json",
    },
  });

  const body = (await response.json()) as T & AsaasError;

  if (!response.ok) {
    const message = body.errors?.[0]?.description ?? `Asaas respondeu ${response.status}`;
    throw new AsaasApiError(message);
  }

  return body;
}

export type AsaasCustomer = { id: string };
export type AsaasSubscription = { id: string; status: string; nextDueDate: string };

export async function createAsaasCustomer(input: {
  name: string;
  email: string;
  cpfCnpj: string;
}): Promise<AsaasCustomer> {
  return asaasFetch<AsaasCustomer>("/customers", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function createAsaasSubscription(input: {
  customer: string;
  billingType: "UNDEFINED" | "PIX" | "CREDIT_CARD" | "BOLETO";
  value: number;
  nextDueDate: string;
  cycle: "MONTHLY" | "YEARLY";
  description: string;
}): Promise<AsaasSubscription> {
  return asaasFetch<AsaasSubscription>("/subscriptions", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export type AsaasPayment = {
  id: string;
  status: string;
  dueDate: string | null;
  invoiceUrl: string | null;
};

const PAYMENT_PAGE_LIMIT = 100;

export async function listAsaasPaymentsOfSubscription(
  subscriptionId: string,
): Promise<AsaasPayment[]> {
  const query = new URLSearchParams({
    subscription: subscriptionId,
    limit: String(PAYMENT_PAGE_LIMIT),
  });
  const body = await asaasFetch<{ data?: AsaasPayment[] }>(`/payments?${query.toString()}`);
  return body.data ?? [];
}
