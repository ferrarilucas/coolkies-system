"use client";

import { useRouter } from "next/navigation";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function CustomerReportToolbar({
  customerId,
  from,
  to,
}: {
  customerId: string;
  from: string;
  to: string;
}) {
  const router = useRouter();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const params = new URLSearchParams({
      from: String(fd.get("from") ?? ""),
      to: String(fd.get("to") ?? ""),
    });
    router.push(`/customers/${customerId}/report?${params.toString()}`);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="print-hidden mb-4 flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3"
    >
      <div className="min-w-0 flex-1 space-y-1.5 sm:flex-none">
        <Label htmlFor="report-from" className="text-xs">
          De
        </Label>
        <Input id="report-from" name="from" type="date" defaultValue={from} required />
      </div>
      <div className="min-w-0 flex-1 space-y-1.5 sm:flex-none">
        <Label htmlFor="report-to" className="text-xs">
          Até
        </Label>
        <Input id="report-to" name="to" type="date" defaultValue={to} required />
      </div>
      <Button type="submit" variant="outline">
        Aplicar
      </Button>
      <Button type="button" onClick={() => window.print()}>
        <Printer />
        Baixar PDF
      </Button>
    </form>
  );
}
