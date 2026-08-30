import { PageHeader } from "@/components/shared/page-header";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { InvitePanel } from "@/components/workspaces/invite-panel";
import { getWorkspaceContext } from "@/server/tenant/context";
import { listMembers, listPendingInvites } from "@/server/tenant/workspaces";
import { roleLabel } from "@/lib/roles";

export default async function MembersPage() {
  const { workspaceId, role } = await getWorkspaceContext();
  const canManage = role === "OWNER" || role === "ADMIN";

  const [members, invites] = await Promise.all([
    listMembers(workspaceId),
    canManage ? listPendingInvites(workspaceId) : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pessoas"
        description="Quem tem acesso a este workspace."
      />

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Membros</h2>
        <ul className="space-y-2">
          {members.map((m) => (
            <li
              key={m.id}
              className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3"
            >
              <Avatar className="size-9">
                {m.image && <AvatarImage src={m.image} alt="" />}
                <AvatarFallback>{m.name.slice(0, 1).toUpperCase()}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {m.name}
                  {m.isSelf && (
                    <span className="text-muted-foreground"> · você</span>
                  )}
                </p>
                <p className="truncate text-xs text-muted-foreground">{m.email}</p>
              </div>
              <Badge variant={m.role === "OWNER" ? "default" : "secondary"}>
                {roleLabel(m.role)}
              </Badge>
            </li>
          ))}
        </ul>
      </section>

      {canManage && (
        <InvitePanel
          invites={invites.map((i) => ({
            id: i.id,
            code: i.code,
            role: i.role,
            email: i.email,
            expiresAt: i.expiresAt.toISOString(),
          }))}
        />
      )}
    </div>
  );
}
