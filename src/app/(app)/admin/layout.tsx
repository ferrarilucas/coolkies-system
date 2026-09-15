import { redirect } from "next/navigation";
import { getWorkspaceContext } from "@/server/tenant/context";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { role } = await getWorkspaceContext();
  if (role !== "OWNER" && role !== "ADMIN") redirect("/dashboard");

  return <>{children}</>;
}
