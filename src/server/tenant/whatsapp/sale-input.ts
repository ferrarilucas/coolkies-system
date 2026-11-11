import { z } from "zod";
import { MAX_INSTALLMENTS } from "@/lib/installments";

export const saleInput = z.object({
  customer: z.string().trim().min(1).max(120),
  items: z.array(z.object({
    description: z.string().trim().min(1).max(150),
    quantity: z.number().int().min(1).max(999),
  })).min(1).max(30),
  installments: z.number().int().min(1).max(MAX_INSTALLMENTS).optional(),
  pending: z.boolean().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export type SaleInput = z.infer<typeof saleInput>;
