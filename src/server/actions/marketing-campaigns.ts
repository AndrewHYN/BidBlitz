"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { hasPermission } from "@/server/permissions";
import { prepareCampaign } from "@/lib/marketing/campaigns";

async function authoriseMarketing() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const allowed = await Promise.all([
    hasPermission(user.id, "marketing.manage"),
    hasPermission(user.id, "settings.manage_marketplace"),
  ]);
  return allowed.some(Boolean) ? supabase : null;
}

export async function createCampaignAction(input: unknown): Promise<
  { ok: true; id: string } | { ok: false; message: string }
> {
  const prepared = prepareCampaign(input);
  if (!prepared) return { ok: false, message: "Check the title, tags, planned date and USD budget (max $100,000)." };
  const supabase = await authoriseMarketing();
  if (!supabase) return { ok: false, message: "Marketing editor permission is required." };
  const { data, error } = await supabase.rpc("admin_create_marketing_campaign", {
    p_title: prepared.title,
    p_objective: prepared.objective,
    p_destination: prepared.destination,
    p_source: prepared.source,
    p_medium: prepared.medium,
    p_campaign_tag: prepared.campaignTag,
    p_content_tag: prepared.contentTag,
    p_brief: prepared.brief,
    p_planned_budget_minor: prepared.budgetMinor,
    p_planned_start: prepared.plannedStart,
  });
  if (error || !data || typeof data !== "object" || data.ok !== true || typeof data.id !== "string") {
    const message = error?.message?.includes("duplicate_campaign_tag")
      ? "This campaign code is already in use. Choose a different campaign tag."
      : "Campaign could not be saved. Nothing was posted or charged.";
    return { ok: false, message };
  }
  revalidatePath("/admin/marketing");
  return { ok: true, id: data.id };
}

const statusInput = z.object({
  campaignId: z.string().uuid(),
  status: z.enum(["READY","RUNNING","PAUSED","COMPLETED"]),
});

export async function changeCampaignStatusAction(input: unknown): Promise<
  { ok: true; status: string } | { ok: false; message: string }
> {
  const parsed = statusInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid campaign status." };
  const supabase = await authoriseMarketing();
  if (!supabase) return { ok: false, message: "Marketing editor permission is required." };

  const { data, error } = await supabase.rpc("admin_set_marketing_campaign_status", {
    p_campaign_id: parsed.data.campaignId,
    p_status: parsed.data.status,
  });
  if (error || !data || typeof data !== "object" || data.ok !== true) {
    return { ok: false, message: "This campaign transition is not allowed. Refresh the page and check its current status." };
  }
  revalidatePath("/admin/marketing");
  return { ok: true, status: data.status };
}
