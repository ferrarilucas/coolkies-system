import { headers } from "next/headers";
import Link from "next/link";
import {
  ClipboardList,
  Boxes,
  Tags,
  UserCheck,
  CreditCard,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import { auth } from "@/lib/auth";
import { PageHeader } from "@/components/shared/page-header";
import { getWorkspaceContext } from "@/server/tenant/context";

type Section = {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
};

type Group = {
  title: string;
  sections: Section[];
};

export default async function AdminPage() {
  const [session, { role }] = await Promise.all([
    auth.api.getSession({ headers: await headers() }),
    getWorkspaceContext(),
  ]);
  const isPlatformAdmin =
    (session?.user as { role?: string } | undefined)?.role === "ADMIN";

  const groups: Group[] = [
    {
      title: "Assinatura",
      sections:
        role === "OWNER"
          ? [
              {
                href: "/workspaces/plan",
                label: "Plano",
                description: "Sua assinatura e forma de pagamento.",
                icon: CreditCard,
              },
            ]
          : [],
    },
    {
      title: "Operação",
      sections: [
        {
          href: "/admin/recipes",
          label: "Fichas técnicas",
          description: "Passo a passo, materiais e custo estimado.",
          icon: ClipboardList,
        },
        {
          href: "/admin/inputs",
          label: "Insumos",
          description: "Itens usados nas fichas técnicas e estoque mínimo.",
          icon: Boxes,
        },
        {
          href: "/admin/catalog",
          label: "Catálogo",
          description: "Produtos, variações e preços de venda.",
          icon: Tags,
        },
      ],
    },
    {
      title: "Plataforma",
      sections: isPlatformAdmin
        ? [
            {
              href: "/admin/access",
              label: "Pré-cadastro",
              description: "E-mails autorizados a acessar o app.",
              icon: UserCheck,
            },
          ]
        : [],
    },
  ].filter((group) => group.sections.length > 0);

  return (
    <div>
      <PageHeader
        title="Configurações"
        description="Plano da assinatura e área administrativa."
      />
      <div className="space-y-8">
        {groups.map((group) => (
          <section key={group.title}>
            <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {group.title}
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3">
              {group.sections.map(({ href, label, description, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className="group flex items-center gap-4 rounded-xl border bg-card p-4 text-card-foreground transition-colors hover:border-primary/40 hover:bg-muted/40 sm:flex-col sm:items-start sm:gap-5 sm:p-5"
                >
                  <div className="flex w-full items-center gap-4 sm:items-start sm:justify-between">
                    <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                      <Icon className="size-5 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1 sm:hidden">
                      <p className="font-medium">{label}</p>
                      <p className="text-sm text-muted-foreground">{description}</p>
                    </div>
                    <ChevronRight className="size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                  </div>
                  <div className="hidden space-y-1 sm:block">
                    <p className="font-medium">{label}</p>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {description}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
