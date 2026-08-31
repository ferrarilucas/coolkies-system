const SANDBOX = "https://api-sandbox.asaas.com/v3";
const PRODUCTION = "https://api.asaas.com/v3";

function baseUrl(): string {
  return process.env.ASAAS_ENV === "production" ? PRODUCTION : SANDBOX;
}

export function brlFromCents(cents: number): number {
  return Math.round(cents) / 100;
}

type AsaasError = { errors?: Array<{ description?: string }> };

export async function asaasFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const key = process.env.ASAAS_API_KEY;
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
    throw new Error(message);
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
  billingType: "PIX" | "CREDIT_CARD" | "BOLETO";
  value: number;
  nextDueDate: string;
  cycle: "MONTHLY" | "YEARLY";
  description: string;
}): Promise<AsaasSubscription> {
  return asaasFetch<AsaasSubscription>("/subscriptions", {
    method: "POST",
    body: JSON.stringify({ ...input, paymentCreationMode: "SUBSCRIPTION" }),
  });
}

export async function getAsaasSubscription(id: string): Promise<AsaasSubscription> {
  return asaasFetch<AsaasSubscription>(`/subscriptions/${id}`);
}
