import Link from "next/link";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";

export function UpgradeNotice({ title, description }: { title: string; description: string }) {
  return (
    <EmptyState
      icon={Sparkles}
      title={title}
      description={description}
      action={
        <Button asChild>
          <Link href="/workspaces/plan">Ver planos</Link>
        </Button>
      }
    />
  );
}
