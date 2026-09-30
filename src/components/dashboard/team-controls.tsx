"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  assignRoleAction,
  inviteMemberAction,
  revokeAllAccessAction,
  revokeInviteAction,
  searchUsersAction,
  setAssignmentStatusAction,
} from "@/server/actions/team";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

/**
 * Team controls. Every mutation names its target and writes an audit row
 * server-side; the UI here only collects the decision and shows the result.
 * Sensitive roles are called out at the point of selection, not buried in
 * documentation, because accidental over-permissioning happens at exactly
 * this screen.
 */

function ActionError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-xs text-destructive">
      {message}
    </p>
  );
}

export function StaffActions({
  assignmentId,
  username,
  status,
}: {
  assignmentId: string;
  username: string;
  status: "ACTIVE" | "SUSPENDED" | "REVOKED";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  function run(
    label: string,
    call: () => Promise<{ ok: boolean; message?: string }>
  ) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await call();
        if (!result.ok) {
          setError(result.message ?? "That change was refused.");
          return;
        }
        setDone(label);
        router.refresh();
      } catch {
        setError("That change was refused. Reload and try again.");
      }
    });
  }

  if (done) {
    return (
      <p role="status" className="text-xs font-medium text-foreground">
        {done}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {status === "ACTIVE" ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() =>
              run("Suspended. They lose staff powers immediately.", () =>
                setAssignmentStatusAction({
                  assignmentId,
                  status: "SUSPENDED",
                  reason: "Suspended from the team console.",
                })
              )
            }
          >
            Suspend
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() =>
              run("Restored.", () =>
                setAssignmentStatusAction({ assignmentId, status: "ACTIVE" })
              )
            }
          >
            Restore
          </Button>
        )}
      </div>
      <ActionError message={error} />
      <p className="text-xs text-muted-foreground">
        @{username} keeps their buyer/seller account and history either way;
        only staff access changes.
      </p>
    </div>
  );
}

export function RevokeAccessButton({ userId }: { userId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);

  function submit() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await revokeAllAccessAction({ userId, reason: reason.trim() || undefined });
        if (!result.ok) {
          setError(result.message);
          return;
        }
        setConfirming(false);
        router.refresh();
      } catch {
        setError("That change was refused. Reload and try again.");
      }
    });
  }

  if (!confirming) {
    return (
      <Button type="button" size="sm" variant="destructive" onClick={() => setConfirming(true)}>
        Revoke all access
      </Button>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-destructive/25 p-3">
      <p className="text-sm font-medium">
        Remove every staff role from this member? Their account and history stay intact.
      </p>
      <div className="space-y-1.5">
        <Label htmlFor={`revoke-reason-${userId}`}>Reason (goes into the audit record)</Label>
        <Textarea
          id={`revoke-reason-${userId}`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          disabled={pending}
        />
      </div>
      <ActionError message={error} />
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => setConfirming(false)}>
          Cancel
        </Button>
        <Button type="button" size="sm" variant="destructive" disabled={pending} onClick={submit}>
          {pending ? "Working…" : "Revoke all access"}
        </Button>
      </div>
    </div>
  );
}

export function PromoteForm({
  roles,
}: {
  roles: Array<{ key: string; name: string; description: string }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Array<{ id: string; username: string; display_name: string }>>([]);
  const [chosen, setChosen] = useState<{ id: string; username: string; display_name: string } | null>(null);
  const [role, setRole] = useState("");
  const [reason, setReason] = useState("");

  async function search() {
    setError(null);
    const result = await searchUsersAction({ query });
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setResults(result.users);
  }

  function submit() {
    if (!chosen || !role) {
      setError("Pick a user and a role first.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const result = await assignRoleAction({
          userId: chosen.id,
          role,
          reason: reason.trim() || undefined,
        });
        if (!result.ok) {
          setError(result.message);
          return;
        }
        setDone(`@${chosen.username} is now ${role}.`);
        setChosen(null);
        setQuery("");
        setResults([]);
        setRole("");
        setReason("");
        router.refresh();
      } catch {
        setError("That change was refused. Reload and try again.");
      }
    });
  }

  if (done) {
    return (
      <p role="status" className="text-sm font-medium text-foreground">
        {done}
      </p>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-48 flex-1 space-y-1.5">
          <Label htmlFor="promote-search">Find user by username or name</Label>
          <Input
            id="promote-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="username"
            disabled={pending}
          />
        </div>
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={search}>
          Search
        </Button>
      </div>
      {results.length > 0 && (
        <ul className="space-y-1">
          {results.map((u) => (
            <li key={u.id}>
              <Button
                type="button"
                size="sm"
                variant={chosen?.id === u.id ? "default" : "ghost"}
                onClick={() => setChosen(u)}
              >
                @{u.username} · {u.display_name}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Role</Label>
          <Select value={role} onValueChange={setRole}>
            <SelectTrigger data-testid="promote-role">
              <SelectValue placeholder="Pick a role" />
            </SelectTrigger>
            <SelectContent>
              {roles.map((r) => (
                <SelectItem key={r.key} value={r.key}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="promote-reason">
            Reason <span className="text-muted-foreground">(optional)</span>
          </Label>
          <Input
            id="promote-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={pending}
            placeholder="Why does this person need access?"
          />
        </div>
      </div>
      {chosen && role && (
        <p className="text-xs text-muted-foreground">
          @{chosen.username} will gain the {role} bundle. Sensitive permissions
          in that bundle apply immediately on confirm.
        </p>
      )}
      <ActionError message={error} />
      <Button type="button" size="sm" disabled={pending || !chosen || !role} onClick={submit}>
        {pending ? "Working…" : "Grant role"}
      </Button>
    </div>
  );
}

export function InviteForm({
  roles,
}: {
  roles: Array<{ key: string; name: string; description: string }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("");

  function submit() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await inviteMemberAction({ email: email.trim(), role });
        if (!result.ok) {
          setError(result.message);
          return;
        }
        setDone(`Invitation queued for ${email.trim()}. It expires in 72 hours and works once.`);
        setEmail("");
        setRole("");
        router.refresh();
      } catch {
        setError("That invitation was refused. Reload and try again.");
      }
    });
  }

  if (done) {
    return (
      <p role="status" className="text-sm font-medium text-foreground">
        {done}
      </p>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="invite-email">Email address</Label>
          <Input
            id="invite-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={pending}
            placeholder="teammate@example.com"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Role</Label>
          <Select value={role} onValueChange={setRole}>
            <SelectTrigger data-testid="invite-role">
              <SelectValue placeholder="Pick a role" />
            </SelectTrigger>
            <SelectContent>
              {roles.map((r) => (
                <SelectItem key={r.key} value={r.key}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <ActionError message={error} />
      <Button type="button" size="sm" disabled={pending || !email.trim() || !role} onClick={submit}>
        {pending ? "Working…" : "Send invitation"}
      </Button>
    </div>
  );
}

export function RevokeInviteButton({ invitationId }: { invitationId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-1">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            try {
              const result = await revokeInviteAction({ invitationId });
              if (!result.ok) {
                setError(result.message);
                return;
              }
              router.refresh();
            } catch {
              setError("That change was refused. Reload and try again.");
            }
          });
        }}
      >
        Revoke
      </Button>
      <ActionError message={error} />
    </div>
  );
}
