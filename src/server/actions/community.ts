"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export async function submitPeerReview(_previous: string, form: FormData): Promise<string> {
  const input = z.object({ peer: z.uuid(), rating: z.coerce.number().int().min(1).max(5), comment: z.string().trim().max(1000) }).safeParse(Object.fromEntries(form));
  if (!input.success) return "Choose a rating from 1 to 5 and keep your review under 1,000 characters.";
  const db = await createClient();
  const { error } = await db.rpc("submit_chat_review", { p_peer: input.data.peer, p_rating: input.data.rating, p_comment: input.data.comment });
  if (error?.code === "23505") return "You’ve already rated this member.";
  if (error) return error.message.includes("exchange_required") ? "You can rate someone after you’ve both sent messages." : "Your rating could not be saved. Try again.";
  revalidatePath("/profile/[username]", "page");
  return "Your rating was published.";
}

export async function decideContentReport(_previous: string, form: FormData): Promise<string> {
  const input = z.object({ report: z.uuid(), decision: z.enum(["hide", "dismiss", "resolve"]) }).safeParse(Object.fromEntries(form));
  if (!input.success) return "Choose a valid report and decision.";
  const db = await createClient();
  const { error } = await db.rpc("decide_marketplace_report", { p_report: input.data.report, p_decision: input.data.decision });
  if (error) return "Decision could not be saved. Refresh the queue and check your permissions.";
  revalidatePath("/admin/community");
  revalidatePath("/profile/[username]", "page");
  return "Decision saved.";
}
