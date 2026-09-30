"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/server/permissions";

/**
 * Team management actions. Every one of them checks admin.manage_team first
 * (except invite acceptance, which checks the token), and the RPCs enforce
 * the full rule set again inside: OWNER-only paths, last-OWNER protection,
 * no self-targeting, no granting unheld permissions. Either layer alone
 * would be a UI restriction pretending to be authorization.
 */

type TeamResult<T = unknown> =
  | ({ ok: true } & T)
  | { ok: false; message: string };

async function teamError(raw: string): Promise<string> {
  const m = raw.toLowerCase();
  if (m.includes("not_admin")) return "Admins only.";
  if (m.includes("owner_only")) return "Only the platform owner can do that.";
  if (m.includes("last_owner")) return "BidBlitz must always have an owner. Assign a replacement first.";
  if (m.includes("cannot_target_self")) return "You can't change your own team access here.";
  if (m.includes("cannot_grant_unheld"))
    return "You can only grant permissions you hold yourself.";
  if (m.includes("invalid_role")) return "That role does not exist.";
  if (m.includes("user_not_found")) return "No BidBlitz account matches.";
  if (m.includes("invalid_email")) return "Enter a valid email address.";
  if (m.includes("duplicate_invite")) return "That address already has a pending invitation.";
  if (m.includes("invalid_invite")) return "That invitation is expired, revoked or already used.";
  if (m.includes("invalid_state")) return "That is no longer pending.";
  if (m.includes("not_authenticated")) return "Sign in.";
  return "That change was refused. Reload and try again.";
}

export async function assignRoleAction(input: unknown): Promise<TeamResult<{ role: string }>> {
  const parsed = z
    .object({
      userId: z.string().uuid("Invalid user"),
      role: z.string().min(1, "Pick a role."),
      reason: z.string().trim().max(1000).optional(),
    })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid request." };
  }
  const gate = await requirePermission("admin.manage_team");
  if (!gate.ok) return gate;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_assign_role", {
    p_user_id: parsed.data.userId,
    p_role_key: parsed.data.role,
    p_reason: parsed.data.reason ?? null,
  });
  if (error) {
    const msg = await teamError(error.message);
    return { ok: false, message: msg };
  }
  revalidatePath("/admin/team");
  return { ok: true, role: (data as { role?: string })?.role ?? parsed.data.role };
}

export async function setAssignmentStatusAction(input: unknown): Promise<TeamResult> {
  const parsed = z
    .object({
      assignmentId: z.string().uuid("Invalid assignment"),
      status: z.enum(["ACTIVE", "SUSPENDED", "REVOKED"]),
      reason: z.string().trim().max(1000).optional(),
    })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid request." };
  }
  const gate = await requirePermission("admin.manage_team");
  if (!gate.ok) return gate;

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_assignment_status", {
    p_assignment_id: parsed.data.assignmentId,
    p_status: parsed.data.status,
    p_reason: parsed.data.reason ?? null,
  });
  if (error) {
    const msg = await teamError(error.message);
    return { ok: false, message: msg };
  }
  revalidatePath("/admin/team");
  return { ok: true };
}

export async function revokeAllAccessAction(input: unknown): Promise<TeamResult<{ revoked: number }>> {
  const parsed = z
    .object({
      userId: z.string().uuid("Invalid user"),
      reason: z.string().trim().max(1000).optional(),
    })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid request." };
  }
  const gate = await requirePermission("admin.manage_team");
  if (!gate.ok) return gate;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_revoke_all_access", {
    p_user_id: parsed.data.userId,
    p_reason: parsed.data.reason ?? null,
  });
  if (error) {
    const msg = await teamError(error.message);
    return { ok: false, message: msg };
  }
  revalidatePath("/admin/team");
  return { ok: true, revoked: (data as { revoked?: number })?.revoked ?? 0 };
}

export async function inviteMemberAction(input: unknown): Promise<TeamResult> {
  const parsed = z
    .object({
      email: z.string().trim().email("Enter a valid email address."),
      role: z.string().min(1, "Pick a role."),
    })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid invitation." };
  }
  const gate = await requirePermission("admin.manage_team");
  if (!gate.ok) return gate;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_invite_member", {
    p_email: parsed.data.email,
    p_role_key: parsed.data.role,
  });
  if (error) {
    const msg = await teamError(error.message);
    return { ok: false, message: msg };
  }
  // The raw token leaves the database exactly once, in this return value, and
  // goes straight into the invitation email below. Afterwards only the hash
  // exists. If the email cannot even be queued, the invitation is revoked
  // again: an invite nobody can receive is a live token with no purpose.
  const invitation = data as { invitation_id?: string; token?: string };
  if (invitation.token && invitation.invitation_id) {
    const { queueEmail, emailKey } = await import("@/server/email/sender");
    const queued = await queueEmail({
      to: parsed.data.email,
      template: "team_invite",
      data: { role: parsed.data.role, token: invitation.token },
      idempotencyKey: emailKey("team_invite", "invitation", invitation.invitation_id),
    });
    if (!queued) {
      await supabase.rpc("admin_revoke_invite", { p_invite_id: invitation.invitation_id });
      return { ok: false, message: "The invitation was created but its email could not be queued, so it was revoked. Try again." };
    }
  }
  revalidatePath("/admin/team");
  return { ok: true, ...invitation };
}

export async function revokeInviteAction(input: unknown): Promise<TeamResult> {
  const parsed = z.object({ invitationId: z.string().uuid("Invalid invitation") }).safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid request." };
  }
  const gate = await requirePermission("admin.manage_team");
  if (!gate.ok) return gate;

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_revoke_invite", {
    p_invite_id: parsed.data.invitationId,
  });
  if (error) {
    const msg = await teamError(error.message);
    return { ok: false, message: msg };
  }
  revalidatePath("/admin/team");
  return { ok: true };
}

export async function acceptInviteAction(input: unknown): Promise<TeamResult<{ role: string }>> {
  const parsed = z.object({ token: z.string().min(8, "Invalid invitation.") }).safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "That invitation link is not valid." };
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sign in with the invited address to accept." };

  const { data, error } = await supabase.rpc("accept_team_invite", {
    p_token: parsed.data.token,
  });
  if (error) {
    // Deliberately vague: a wrong or mismatched token reveals nothing beyond
    // invalid, so invitations cannot be probed.
    return { ok: false, message: "That invitation link is expired, revoked or already used." };
  }
  revalidatePath("/admin/team");
  return { ok: true, role: (data as { role?: string })?.role ?? "" };
}

/** Admin username/display-name search for promotion. Admin-only by RLS. */
export async function searchUsersAction(input: unknown): Promise<
  TeamResult<{ users: Array<{ id: string; username: string; display_name: string }> }>
> {
  const parsed = z.object({ query: z.string().trim().min(2).max(60) }).safeParse(input);
  if (!parsed.success) return { ok: false, message: "Type at least 2 characters." };
  const gate = await requirePermission("admin.manage_team");
  if (!gate.ok) return gate;

  const supabase = await createClient();
  const q = `%${parsed.data.query}%`;
  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, display_name")
    .or(`username.ilike.${q},display_name.ilike.${q}`)
    .limit(8);
  if (error) return { ok: false, message: "Search failed. Try again." };
  return { ok: true, users: (data ?? []) as Array<{ id: string; username: string; display_name: string }> };
}
