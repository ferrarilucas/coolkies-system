import Link from "next/link";
import { ChefHat, Carrot, Tags, UserCheck, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";

const sections = [
  {
    href: "/admin/recipes",
    label: "Receitas",
    description: "Passo a passo, ingredientes e custo estimado.",
    icon: ChefHat,
  },
  {
    href: "/admin/ingredients",
    label: "Ingredientes",
    description: "Itens usados nas receitas e estoque mínimo.",
    icon: Carrot,
  },
  {
    href: "/admin/catalog",
    label: "Catálogo",
    description: "Produtos, sabores e preços de venda.",
    icon: Tags,
  },
  {
    href: "/admin/access",
    label: "Pré-cadastro",
    description: "E-mails autorizados a acessar o app.",
    icon: UserCheck,
  },
];

export default function AdminPage() {
  return (
    <div>
      <PageHeader title="Cadastros" description="Área administrativa." />
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
