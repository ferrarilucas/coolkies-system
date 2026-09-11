import Stripe from "stripe";
import type { PlanCycle } from "@/lib/plans";

export const STRIPE_API_VERSION = "2026-08-26.dahlia";

export class StripeConfigError extends Error {}

export class StripeApiError extends Error {
  readonly code: string;
  readonly requestId: string | null;

  constructor(code: string, message: string, requestId: string | null) {
    super(message);
    this.code = code;
    this.requestId = requestId;
  }
}

let cached: Stripe | null = null;

export function stripe(): Stripe {
  if (cached) return cached;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new StripeConfigError("STRIPE_SECRET_KEY não configurada");
  cached = new Stripe(key, { apiVersion: STRIPE_API_VERSION });
  return cached;
}

export function isStripeEnabled(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

const PRICE_ENV_BY_PLAN_CYCLE: Record<string, Record<PlanCycle, string>> = {
  corre: {
    MONTHLY: "STRIPE_PRICE_CORRE_MONTHLY",
    YEARLY: "STRIPE_PRICE_CORRE_YEARLY",
  },
  cresce: {
    MONTHLY: "STRIPE_PRICE_CRESCE_MONTHLY",
    YEARLY: "STRIPE_PRICE_CRESCE_YEARLY",
  },
};

export function priceEnvVar(plan: string, cycle: PlanCycle): string | null {
  return PRICE_ENV_BY_PLAN_CYCLE[plan]?.[cycle] ?? null;
}

export function priceIdFor(plan: string, cycle: PlanCycle): string {
  const envVar = priceEnvVar(plan, cycle);
  if (!envVar) {
    throw new StripeConfigError(`Plano ${plan} não é contratável por cartão.`);
  }
  const value = process.env[envVar];
  if (!value) {
    throw new StripeConfigError(`${envVar} não configurada`);
  }
  return value;
}

function requestIdOf(error: unknown): string | null {
  if (error && typeof error === "object" && "requestId" in error) {
    const id = (error as { requestId?: unknown }).requestId;
    return typeof id === "string" ? id : null;
  }
  return null;
}

function codeOf(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  if (error && typeof error === "object" && "type" in error) {
    const type = (error as { type?: unknown }).type;
    if (typeof type === "string") return type;
  }
  return "INTERNAL_ERROR";
}

export function asStripeApiError(error: unknown): StripeApiError {
  if (error instanceof StripeApiError) return error;
  const message = error instanceof Error ? error.message : "Erro desconhecido na Stripe";
  return new StripeApiError(codeOf(error), message, requestIdOf(error));
}

export type StripeSubscriptionMode = "payment" | "setup";

export type CreateStripeSubscriptionInput = {
  customerId: string;
  priceId: string;
  mode: StripeSubscriptionMode;
  trialEnd?: number;
  idempotencyKey: string;
  metadata: Record<string, string>;
};

export type CreatedStripeSubscription = {
  subscriptionId: string;
  clientSecret: string;
  mode: StripeSubscriptionMode;
};

export async function getOrCreateStripeCustomer(input: {
  userId: string;
  email: string;
  name: string;
  existingCustomerId: string | null;
}): Promise<string> {
  const client = stripe();
  try {
    if (input.existingCustomerId) {
      const found = await client.customers.retrieve(input.existingCustomerId);
      if (!found.deleted) return found.id;
    }
    const created = await client.customers.create(
      {
        email: input.email,
        name: input.name,
        metadata: { userId: input.userId },
      },
      { idempotencyKey: `customer:${input.userId}` },
    );
    return created.id;
  } catch (error) {
    throw asStripeApiError(error);
  }
}

export async function createStripeSubscription(
  input: CreateStripeSubscriptionInput,
): Promise<CreatedStripeSubscription> {
  const client = stripe();
  try {
    if (input.mode === "setup") {
      const sub = await client.subscriptions.create(
        {
          customer: input.customerId,
          items: [{ price: input.priceId }],
          trial_end: input.trialEnd,
          payment_behavior: "default_incomplete",
          trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
          expand: ["pending_setup_intent"],
          metadata: input.metadata,
        },
        { idempotencyKey: input.idempotencyKey },
      );
      const setupIntent = sub.pending_setup_intent;
      const clientSecret =
        setupIntent && typeof setupIntent !== "string"
          ? setupIntent.client_secret
          : null;
      if (!clientSecret) {
        throw new StripeApiError(
          "MISSING_CLIENT_SECRET",
          "Assinatura em setup criada sem pending_setup_intent",
          null,
        );
      }
      return { subscriptionId: sub.id, clientSecret, mode: "setup" };
    }

    const sub = await client.subscriptions.create(
      {
        customer: input.customerId,
        items: [{ price: input.priceId }],
        payment_behavior: "default_incomplete",
        expand: ["latest_invoice.confirmation_secret"],
        metadata: input.metadata,
      },
      { idempotencyKey: input.idempotencyKey },
    );
    const invoice = sub.latest_invoice;
    const clientSecret =
      invoice && typeof invoice !== "string"
        ? (invoice.confirmation_secret?.client_secret ?? null)
        : null;
    if (!clientSecret) {
      throw new StripeApiError(
        "MISSING_CLIENT_SECRET",
        "Assinatura em payment criada sem confirmation_secret",
        null,
      );
    }
    return { subscriptionId: sub.id, clientSecret, mode: "payment" };
  } catch (error) {
    throw asStripeApiError(error);
  }
}

export async function retrieveStripeSubscription(
  subscriptionId: string,
): Promise<Stripe.Subscription> {
  try {
    return await stripe().subscriptions.retrieve(subscriptionId, {
      expand: ["items", "default_payment_method"],
    });
  } catch (error) {
    throw asStripeApiError(error);
  }
}

export function constructStripeEvent(rawBody: string, signature: string): Stripe.Event {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new StripeConfigError("STRIPE_WEBHOOK_SECRET não configurada");
  return stripe().webhooks.constructEvent(rawBody, signature, secret);
}
