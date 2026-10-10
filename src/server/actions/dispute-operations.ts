"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/server/permissions";

const assignSchema = z.object({
  disputeId: z.string().uuid(),
  assigneeId: z.string().uuid(),
  priority: z.enum(["NORMAL","HIGH","URGENT"]),
  targetHours: z.union([z.literal(24),z.literal(48),z.literal(72)]),
}).strict();
const noteSchema = z.object({
  disputeId: z.string().uuid(),
  note: z.string().trim().min(10).max(3000),
}).strict();
type Result = { ok: true } | { ok: false; message: string };

function problem(raw?: string): string {
  const text = raw?.toLowerCase() ?? "";
  if (text.includes("case_not_assignable")) return "This case is already resolved or unavailable.";
  if (text.includes("invalid_assignment")) return "Choose an active dispute agent, a priority and an allowed review target.";
  if (text.includes("invalid_note")) return "Write a private note between 10 and 3000 characters.";
  if (text.includes("not_authorised")) return "You do not have permission to manage dispute cases.";
  return "The database refused this change. No payout or case outcome was changed.";
}

export async function assignDisputeAgentAction(input: unknown): Promise<Result> {
  const parse = assignSchema.safeParse(input);
  if (!parse.success) return { ok: false, message: "Choose a valid agent, priority and review deadline." };
  const gate = await requirePermission("disputes.manage");
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("staff_assign_dispute_case", {
    p_dispute_id: parse.data.disputeId,
    p_assignee: parse.data.assigneeId,
    p_priority: parse.data.priority,
    p_target_hours: parse.data.targetHours,
  });
  if (error || data?.ok !== true) return { ok: false, message: problem(error?.message) };
  revalidatePath("/admin/disputes");
  revalidatePath(`/admin/disputes/${parse.data.disputeId}`);
  return { ok: true };
}

export async function addPrivateDisputeNoteAction(input: unknown): Promise<Result> {
  const parse = noteSchema.safeParse(input);
  if (!parse.success) return { ok: false, message: "Private notes must be between 10 and 3000 characters." };
  const gate = await requirePermission("disputes.manage");
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("staff_add_private_dispute_note", {
    p_dispute_id: parse.data.disputeId,
    p_note: parse.data.note,
  });
  if (error || data?.ok !== true) return { ok: false, message: problem(error?.message) };
  revalidatePath("/admin/disputes");
  revalidatePath(`/admin/disputes/${parse.data.disputeId}`);
  return { ok: true };
}
