import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * Team authorization for server code. The database is authoritative
 * (public.has_permission reads live assignments, so revocation applies on the
 * next check, never on the next login); these helpers are just typed,
 * auditable call sites for it.
 *
 * Frontend visibility is never authorization: every sensitive action below
 * re-checks here or inside its RPC, and the RPCs check again themselves.
 */

export async function callerId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

export async function hasPermission(
  userId: string | null,
  permission: string
): Promise<boolean> {
  if (!userId) return false;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("has_permission", {
    p_user_id: userId,
    p_permission: permission,
  });
  if (error) return false;
  return data === true;
}

export async function requirePermission(
  permission: string
): Promise<{ ok: true; userId: string } | { ok: false; message: string }> {
  const userId = await callerId();
  if (!userId) return { ok: false, message: "Sign in." };
  const allowed = await hasPermission(userId, permission);
  if (!allowed) return { ok: false, message: "Admins only." };
  return { ok: true, userId };
}

/** Effective permission keys for display (team roster, confirmations). */
export async function effectivePermissions(userId: string): Promise<string[]> {
  const supabase = await createClient();
  // Two reads joined here, because staff_assignments has no foreign key into
  // staff_role_permissions (both point at roles, not at each other), so
  // PostgREST cannot embed one in the other.
  const [{ data: assignments }, { data: grants }] = await Promise.all([
    supabase.from("staff_assignments").select("role_key").eq("user_id", userId).eq("status", "ACTIVE"),
    supabase.from("staff_role_permissions").select("role_key, permission_key"),
  ]);
  const rows = (assignments ?? []) as Array<{ role_key: string }>;
  if (rows.some((r) => r.role_key === "OWNER")) return ["*"];
  const byRole = new Map<string, string[]>();
  for (const g of (grants ?? []) as Array<{ role_key: string; permission_key: string }>) {
    const list = byRole.get(g.role_key) ?? [];
    list.push(g.permission_key);
    byRole.set(g.role_key, list);
  }
  const out = new Set<string>();
  for (const r of rows) for (const p of byRole.get(r.role_key) ?? []) out.add(p);
  return [...out].sort();
}
