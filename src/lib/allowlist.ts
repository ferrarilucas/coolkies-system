import { db } from "./db";

/** Normaliza e-mail para comparação (case-insensitive, sem espaços). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Retorna a entrada de pré-cadastro do e-mail, ou null se não autorizado. */
export async function findAllowedEmail(email: string) {
  return db.allowedEmail.findUnique({
    where: { email: normalizeEmail(email) },
  });
}

/** Conveniência: o e-mail está na allowlist? */
export async function isEmailAllowed(email: string): Promise<boolean> {
  return (await findAllowedEmail(email)) !== null;
}
