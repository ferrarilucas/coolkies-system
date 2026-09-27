import { describe, expect, it } from "vitest";
import { legalEntity, TERMS_VERSION } from "./legal";
import { privacySections, termsSections } from "./legal-content";

const env = {
  LEGAL_ENTITY_NAME: "Coolkies Tecnologia Ltda",
  LEGAL_ENTITY_DOCUMENT: "00.000.000/0001-00",
  LEGAL_CONTACT_EMAIL: "privacidade@coolkies.example",
};

describe("legal", () => {
  it("lê os dados da empresa do ambiente", () => {
    expect(legalEntity(env)).toEqual({
      name: "Coolkies Tecnologia Ltda",
      document: "00.000.000/0001-00",
      contactEmail: "privacidade@coolkies.example",
    });
  });

  it("falha se faltar qualquer dado", () => {
    expect(() => legalEntity({ ...env, LEGAL_CONTACT_EMAIL: undefined })).toThrow("LEGAL_CONTACT_EMAIL");
  });

  it("a versão dos termos é uma data ISO", () => {
    expect(TERMS_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("os textos citam a empresa e o contato", () => {
    const entity = legalEntity(env);
    const terms = JSON.stringify(termsSections(entity));
    const privacy = JSON.stringify(privacySections(entity));
    expect(terms).toContain(entity.name);
    expect(terms).toContain(entity.document);
    expect(privacy).toContain(entity.contactEmail);
    expect(privacy).toContain("Minha conta");
  });
});
