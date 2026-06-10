import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { AppShell } from "@/components/layout/app-shell";
import { isEmailAllowed } from "@/lib/allowlist";
import type { SessionUser } from "@/lib/session-user";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  // Revalida a allowlist a cada acesso (cobre revogação de pré-cadastro).
  if (!(await isEmailAllowed(session.user.email))) redirect("/not-authorized");

  const u = session.user as typeof session.user & { role?: string };
  const user: SessionUser = {
    name: u.name,
    email: u.email,
    image: u.image ?? null,
    role: u.role ?? "USER",
  };

  return <AppShell user={user}>{children}</AppShell>;
}
