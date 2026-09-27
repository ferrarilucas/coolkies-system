import Link from "next/link";
import type { LegalSection } from "@/lib/legal-content";

export function LegalDocument({
  title,
  version,
  sections,
}: {
  title: string;
  version: string;
  sections: LegalSection[];
}) {
  return (
    <main className="mx-auto max-w-2xl space-y-8 px-6 py-10">
      <div className="space-y-1">
        <Link href="/sign-in" className="text-xs text-muted-foreground underline-offset-4 hover:underline">
          Coolkies
        </Link>
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">Versão de {version}</p>
      </div>
      {sections.map((s) => (
        <section key={s.heading} className="space-y-2">
          <h2 className="font-medium">{s.heading}</h2>
          {s.paragraphs.map((p) => (
            <p key={p} className="text-sm leading-relaxed text-muted-foreground">
              {p}
            </p>
          ))}
        </section>
      ))}
    </main>
  );
}
