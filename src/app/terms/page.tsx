import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal/legal-document";
import { legalEntity, TERMS_VERSION } from "@/lib/legal";
import { termsSections } from "@/lib/legal-content";

export const metadata: Metadata = { title: "Termos de uso · Cipri" };

export default function TermsPage() {
  return <LegalDocument title="Termos de uso" version={TERMS_VERSION} sections={termsSections(legalEntity())} />;
}
