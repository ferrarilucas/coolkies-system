"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

function applyPhoneMask(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 11);
  const d = digits;

  if (d.length === 0) return "";
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  // Mobile (11 dígitos): (XX) XXXXX-XXXX
  // Fixo   (10 dígitos): (XX) XXXX-XXXX
  const isMobile = d.length > 10 || (d.length === 10 ? false : d.length >= 7);
  const mid = isMobile ? 7 : 6;
  if (d.length <= mid) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, mid)}-${d.slice(mid)}`;
}

export interface PhoneInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> {
  value?: string;
  onChange?: (value: string) => void;
  // Para uso em forms não-controlados
  name?: string;
  defaultValue?: string;
}

export const PhoneInput = React.forwardRef<HTMLInputElement, PhoneInputProps>(
  ({ value, onChange, defaultValue, className, ...props }, ref) => {
    const isControlled = value !== undefined;
    const [internalValue, setInternalValue] = React.useState(
      defaultValue ? applyPhoneMask(defaultValue) : "",
    );

    const displayValue = isControlled ? applyPhoneMask(value ?? "") : internalValue;

    function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
      const masked = applyPhoneMask(e.target.value);
      if (!isControlled) setInternalValue(masked);
      onChange?.(masked);
    }

    return (
      <Input
        ref={ref}
        type="tel"
        inputMode="numeric"
        value={displayValue}
        onChange={handleChange}
        placeholder="(11) 99999-9999"
        className={cn("tabular-nums", className)}
        {...props}
      />
    );
  },
);
PhoneInput.displayName = "PhoneInput";
