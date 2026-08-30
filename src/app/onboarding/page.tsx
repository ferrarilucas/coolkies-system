import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { Cookie } from "lucide-react";
import { auth } from "@/lib/auth";
import { listUserWorkspaces } from "@/server/tenant/workspaces";
import {
  CreateWorkspaceForm,
  JoinWorkspaceForm,
} from "@/components/workspaces/workspace-forms";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default async function OnboardingPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const workspaces = await listUserWorkspaces();
  if (workspaces.length > 0) redirect("/dashboard");

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-2 text-center">
          <Cookie className="mx-auto size-9 text-primary" />
          <h1 className="text-xl font-semibold">Bem-vinda!</h1>
          <p className="text-sm text-muted-foreground">
            Para começar, crie o workspace do seu negócio ou entre em um
            existente com o código que te enviaram.
          </p>
        </div>

        <Tabs defaultValue="create">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="create">Criar</TabsTrigger>
            <TabsTrigger value="join">Tenho um código</TabsTrigger>
          </TabsList>
          <TabsContent value="create" className="pt-4">
            <CreateWorkspaceForm />
          </TabsContent>
          <TabsContent value="join" className="pt-4">
            <JoinWorkspaceForm />
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}
