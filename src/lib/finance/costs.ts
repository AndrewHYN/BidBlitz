import { z } from "zod";
import { parseMoneyToMinor } from "@/lib/money";

export const COST_CATEGORIES = ["PAYROLL","MARKETING","PROVIDER_FEES","HOSTING","OPERATIONS","OTHER"] as const;
export const costInputSchema = z.object({
  description: z.string().trim().min(5).max(180),
  category: z.enum(COST_CATEGORIES),
  payee: z.string().trim().min(2).max(120),
  amountUsd: z.string().trim().min(1).max(20),
  incurredOn: z.string().optional().default(""),
}).strict();
export type CostInput = z.input<typeof costInputSchema>;
export function prepareCost(value: unknown) {
  const parsed = costInputSchema.safeParse(value);
  if (!parsed.success) return null;
  const amount = parseMoneyToMinor(parsed.data.amountUsd,"USD");
  if (amount === null || amount < 1n || amount > 100000000n) return null;
  const incurredOn = parsed.data.incurredOn;
  if (incurredOn && (!/^\d{4}-\d{2}-\d{2}$/.test(incurredOn) ||
    Number.isNaN(Date.parse(incurredOn)) ||
    new Date(incurredOn).toISOString().slice(0,10) !== incurredOn)) return null;
  return { ...parsed.data, amountMinor: Number(amount), incurredOn: incurredOn || null };
}

export const COST_STATUSES = ["PLANNED","INCURRED","PAID","VOIDED"] as const;
export function nextCostStatuses(status: string): string[] {
  if (status === "PLANNED") return ["INCURRED","VOIDED"];
  if (status === "INCURRED") return ["PAID","VOIDED"];
  return [];
}
