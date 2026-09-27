export const TERMS_VERSION = "2026-09-27";

export type LegalEntity = { name: string; document: string; contactEmail: string };

export function legalEntity(env: Record<string, string | undefined> = process.env): LegalEntity {
  const name = env.LEGAL_ENTITY_NAME;
  const document = env.LEGAL_ENTITY_DOCUMENT;
  const contactEmail = env.LEGAL_CONTACT_EMAIL;
  if (!name || !document || !contactEmail) {
    throw new Error(
      "Defina LEGAL_ENTITY_NAME, LEGAL_ENTITY_DOCUMENT e LEGAL_CONTACT_EMAIL para publicar os termos.",
    );
  }
  return { name, document, contactEmail };
}
