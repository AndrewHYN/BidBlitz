import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { hasPermission } from "@/server/permissions";
import { EmptyState, PageHeader, SectionHeading } from "@/components/auction/page-header";
import {
  InviteForm,
  PromoteForm,
  RevokeInviteButton,
  StaffActions,
} from "@/components/dashboard/team-controls";
import { Users } from "lucide-react";

export const metadata = {
  title: "Team",
  description: "BidBlitz staff roles, invitations and access changes.",
  robots: { index: false, follow: false },
};

type AssignmentRow = {
  id: string;
  user_id: string;
  role_key: string;
  status: "ACTIVE" | "SUSPENDED" | "REVOKED";
  granted_at: string;
  reason: string | null;
};

type AuditRow = {
  id: string;
  created_at: string;
  action: string;
  target_user_id: string | null;
  previous_state: Record<string, unknown>;
  new_state: Record<string, unknown>;
  reason: string | null;
};

type InviteRow = {
  id: string;
  email: string;
  role_key: string;
  created_at: string;
  expires_at: string;
};

export default async function TeamPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/team");

  const canManage = await hasPermission(user.id, "admin.manage_team");
  if (!canManage) redirect("/admin");

  const [assignmentsRes, invitesRes, auditRes, rolesRes] = await Promise.all([
    supabase
      .from("staff_assignments")
      .select("id, user_id, role_key, status, granted_at, reason")
      .neq("status", "REVOKED")
      .order("granted_at", { ascending: false })
      .limit(100),
    supabase
      .from("team_invitations")
      .select("id, email, role_key, created_at, expires_at")
      .is("accepted_at", null)
      .is("revoked_at", null)
      // Expired rows stay visible until revoked: expiry is enforced by the
      // accept RPC on the database clock, and a stale row here is a prompt
      // to revoke it, not a grant of anything.
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("staff_audit")
      .select("id, created_at, action, target_user_id, previous_state, new_state, reason")
      .order("created_at", { ascending: false })
      .limit(30),
    supabase.from("staff_roles").select("key, name, description").order("key"),
  ]);

  const assignments = ((assignmentsRes.data ?? []) as AssignmentRow[]);
  const memberIds = [...new Set(assignments.map((a) => a.user_id))];
  // The audit stores actor/target ids; resolve names in one batched read.
  const auditTargetIds = [
    ...new Set(
      ((auditRes.data ?? []) as AuditRow[]).flatMap((e) =>
        [e.target_user_id].filter((v): v is string => v !== null)
      )
    ),
  ];
  const { data: memberRows } = memberIds.length > 0
    ? await supabase.from("profiles").select("id, username, display_name").in("id", memberIds)
    : { data: [] as Array<{ id: string; username: string; display_name: string }> };
  const { data: auditUserRows } = auditTargetIds.length > 0
    ? await supabase.from("profiles").select("id, username").in("id", auditTargetIds)
    : { data: [] as Array<{ id: string; username: string }> };
  const memberById = new Map(((memberRows ?? []) as Array<{ id: string; username: string; display_name: string }>).map((u) => [u.id, u]));
  const auditUserById = new Map(
    ((auditUserRows ?? []) as Array<{ id: string; username: string }>).map((u) => [u.id, u])
  );
  const roles = ((rolesRes.data ?? []) as Array<{ key: string; name: string; description: string }>);
  const invites = ((invitesRes.data ?? []) as InviteRow[]);
  const audit = ((auditRes.data ?? []) as AuditRow[]);

  return (
    <div className="page-container space-y-8 py-10 sm:py-14" data-testid="admin-team-page">
      <PageHeader
        title="Team"
        description="Who holds staff access, what it grants, and every change ever made to it."
        actions={
          <Link
            href="/admin"
            className="text-sm font-medium text-primary hover:underline"
          >
            Back to admin
          </Link>
        }
      />

      <section aria-labelledby="team-members-heading" className="space-y-4">
        <SectionHeading
          title={<span id="team-members-heading">Members ({assignments.length})</span>}
        />
        {assignments.length === 0 ? (
          <EmptyState
            compact
            icon={Users}
            title="No staff yet"
            description="Promote a user or send an invitation below."
          />
        ) : (
          <ul className="space-y-2">
            {assignments.map((a) => {
              const member = memberById.get(a.user_id);
              const isOwner = a.role_key === "OWNER";
              return (
                <li
                  key={a.id}
                  data-testid="team-member-row"
                  className="space-y-2 rounded-lg border bg-card p-4"
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="text-sm font-medium">
                      @{member?.username ?? "unknown"}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {member?.display_name}
                    </span>
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium">
                      {isOwner ? "Platform Owner" : a.role_key}
                    </span>
                    {a.status === "SUSPENDED" && (
                      <span className="rounded-full bg-ending px-2 py-0.5 text-xs font-medium text-ending-foreground">
                        Suspended
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {a.status === "ACTIVE" ? "Active" : "Suspended"} since{" "}
                    {new Date(a.granted_at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                    {a.reason ? ` · ${a.reason}` : ""}
                  </p>
                  {!isOwner && (
                    <StaffActions
                      assignmentId={a.id}
                      username={member?.username ?? "member"}
                      status={a.status}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="team-promote-heading" className="space-y-4">
        <SectionHeading title={<span id="team-promote-heading">Promote an existing user</span>} />
        <PromoteForm roles={roles.filter((r) => r.key !== "OWNER")} />
      </section>

      <section aria-labelledby="team-invite-heading" className="space-y-4">
        <SectionHeading title={<span id="team-invite-heading">Invite a new member</span>} />
        <InviteForm roles={roles.filter((r) => r.key !== "OWNER")} />
        {invites.length > 0 && (
          <ul className="space-y-2">
            {invites.map((i) => (
              <li
                key={i.id}
                data-testid="team-invite-row"
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card p-4 text-sm"
              >
                <span>
                  {i.email} · {i.role_key} · expires{" "}
                  {new Date(i.expires_at).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
                <RevokeInviteButton invitationId={i.id} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="team-audit-heading" className="space-y-4">
        <SectionHeading title={<span id="team-audit-heading">Recent access changes</span>} />
        {audit.length === 0 ? (
          <EmptyState
            compact
            icon={Users}
            title="No changes recorded"
            description="Every promotion, suspension, revocation and invitation lands here."
          />
        ) : (
          <ul className="space-y-2">
            {audit.map((e) => (
              <li
                key={e.id}
                data-testid="team-audit-row"
                className="space-y-1 rounded-lg border bg-card p-4 text-sm"
              >
                <p>
                  <span className="font-medium">{e.action.replaceAll("_", " ").toLowerCase()}</span>{" "}
                  <span className="text-muted-foreground">
                    {e.target_user_id
                      ? `@${auditUserById.get(e.target_user_id)?.username ?? "unknown"}`
                      : ""}{" "}
                    · {new Date(e.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  </span>
                </p>
                {e.reason && <p className="text-muted-foreground">{e.reason}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}


