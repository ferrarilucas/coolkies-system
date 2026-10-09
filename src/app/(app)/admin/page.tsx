import { headers } from "next/headers";
import Link from "next/link";
import {
  ClipboardList,
  Boxes,
  Tags,
  UserCheck,
  CreditCard,
  ChevronRight,
} from "lucide-react";
import { auth } from "@/lib/auth";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { getWorkspaceContext } from "@/server/tenant/context";

export default async function AdminPage() {
  const [session, { role }] = await Promise.all([
    auth.api.getSession({ headers: await headers() }),
    getWorkspaceContext(),
  ]);
  const isPlatformAdmin =
    (session?.user as { role?: string } | undefined)?.role === "ADMIN";

  const sections = [
    ...(role === "OWNER"
      ? [
          {
            href: "/workspaces/plan",
            label: "Plano",
            description: "Sua assinatura e forma de pagamento.",
            icon: CreditCard,
          },
        ]
      : []),
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
    ...(isPlatformAdmin
      ? [
          {
            href: "/admin/access",
            label: "Pré-cadastro",
            description: "E-mails autorizados a acessar o app.",
            icon: UserCheck,
          },
        ]
      : []),
  ];

  return (
    <div>
      <PageHeader
        title="Configurações"
        description="Plano da assinatura e área administrativa."
      />
      <div className="space-y-3">
        {sections.map(({ href, label, description, icon: Icon }) => (
          <Link key={href} href={href}>
            <Card className="transition-colors hover:bg-muted/50">
              <CardContent className="flex items-center gap-4 p-4">
                <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
                  <Icon className="size-5 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{label}</p>
                  <p className="text-sm text-muted-foreground">{description}</p>
                </div>
                <ChevronRight className="size-5 text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
