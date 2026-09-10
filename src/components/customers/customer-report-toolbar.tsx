"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Download } from "lucide-react";
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
  const [fromValue, setFromValue] = useState(from);
  const [toValue, setToValue] = useState(to);

  const query = new URLSearchParams({ from: fromValue, to: toValue }).toString();
  const isDirty = fromValue !== from || toValue !== to;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    router.push(`/customers/${customerId}/report?${query}`);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="print-hidden mb-4 rounded-lg border bg-card p-3"
    >
      <div className="grid grid-cols-2 items-end gap-2 sm:grid-cols-[minmax(0,9rem)_minmax(0,9rem)_auto_auto] sm:gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="report-from" className="text-xs text-muted-foreground">
            De
          </Label>
          <Input
            id="report-from"
            type="date"
            value={fromValue}
            max={toValue}
            onChange={(e) => setFromValue(e.target.value)}
            required
            className="w-full"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="report-to" className="text-xs text-muted-foreground">
            Até
          </Label>
          <Input
            id="report-to"
            type="date"
            value={toValue}
            min={fromValue}
            onChange={(e) => setToValue(e.target.value)}
            required
            className="w-full"
          />
        </div>

        <Button type="submit" variant={isDirty ? "default" : "outline"}>
          Aplicar
        </Button>

        <Button asChild variant={isDirty ? "outline" : "default"}>
          <a
            href={`/customers/${customerId}/report/pdf?${query}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Download />
            Baixar PDF
          </a>
        </Button>
      </div>
    </form>
  );
}
