import { UserCheck } from "lucide-react";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { AddAllowedEmailForm } from "@/components/admin/add-allowed-email-form";

export default async function AccessPage() {
  const allowed = await db.allowedEmail.findMany({
    orderBy: { createdAt: "asc" },
  });

  return (
    <div>
      <PageHeader
        title="Pré-cadastro"
        description="Apenas e-mails desta lista podem acessar o app."
        backHref="/admin"
      />

      <Card className="mb-4">
        <CardContent className="pt-6">
          <AddAllowedEmailForm />
        </CardContent>
      </Card>

      {allowed.length === 0 ? (
        <EmptyState
          icon={UserCheck}
          title="Nenhum e-mail liberado"
          description="Adicione o e-mail de quem pode acessar o app."
        />
      ) : (
        <ul className="space-y-2">
          {allowed.map((entry) => (
            <li key={entry.id}>
              <Card>
                <CardContent className="flex items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {entry.email}
                    </p>
                    {entry.note ? (
                      <p className="truncate text-xs text-muted-foreground">
                        {entry.note}
                      </p>
                    ) : null}
                  </div>
                  <Badge
                    variant={entry.role === "ADMIN" ? "default" : "secondary"}
                  >
                    {entry.role === "ADMIN" ? "Admin" : "Usuário"}
                  </Badge>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
