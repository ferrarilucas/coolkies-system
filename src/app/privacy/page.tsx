import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal/legal-document";
import { legalEntity, TERMS_VERSION } from "@/lib/legal";
import { privacySections } from "@/lib/legal-content";

export const metadata: Metadata = { title: "Política de privacidade · Cipri" };

export default function PrivacyPage() {
  return (
    <LegalDocument title="Política de privacidade" version={TERMS_VERSION} sections={privacySections(legalEntity())} />
  );
}
