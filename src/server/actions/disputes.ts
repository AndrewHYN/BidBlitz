"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateAvatarBytes } from "@/lib/avatar";
import type {
  DisputePayoutResolution,
  DisputeReason,
  DisputeResolution,
  DisputeStatus,
} from "@/lib/supabase/types";
import { hasPermission } from "@/server/permissions";
import { notifyAdmins } from "@/server/email/notify";
import { emailKey } from "@/server/email/key";

const reasonSchema = z.enum([
  "ITEM_NOT_RECEIVED",
  "ITEM_NOT_AS_DESCRIBED",
  "ITEM_DAMAGED",
  "HANDOVER_SAFETY",
  "PAYMENT_OR_PAYOUT",
  "OTHER",
]);

const statusSchema = z.enum([
  "OPEN",
  "WAITING_FOR_BUYER",
  "WAITING_FOR_SELLER",
  "UNDER_REVIEW",
  "RESOLVED",
]);

const resolutionSchema = z.enum([
  "AGREEMENT_REACHED",
  "SELLER_RESPONSIBLE",
  "BUYER_RESPONSIBLE",
  "INSUFFICIENT_EVIDENCE",
  "CLOSED_NO_ACTION",
  "OTHER",
]);

const payoutResolutionSchema = z.enum(["RELEASE", "HOLD", "NONE"]);

const openSchema = z.object({
  transactionId: z.string().uuid("Invalid sale"),
  reason: reasonSchema,
  summary: z
    .string()
    .trim()
    .min(10, "Give BidBlitz a little more detail about what happened.")
    .max(3000, "Keep the opening statement under 3000 characters."),
});

const messageSchema = z.object({
  disputeId: z.string().uuid("Invalid dispute"),
  body: z.string().trim().min(1, "Write a message first.").max(3000),
});

const staffUpdateSchema = z.object({
  disputeId: z.string().uuid("Invalid dispute"),
  status: statusSchema,
  resolution: resolutionSchema.nullish(),
  payoutResolution: payoutResolutionSchema.nullish(),
  resolutionNote: z.string().trim().max(4000).nullish(),
});

export type DisputeActionResult =
  | { ok: true; disputeId: string }
  | { ok: false; message: string };

function rpcMessage(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("payment_not_confirmed")) return "A dispute can be opened after the buyer payment is confirmed.";
  if (m.includes("not_party")) return "Only the buyer, seller or authorised BidBlitz staff can use this dispute.";
  if (m.includes("dispute_resolved")) return "This dispute is already resolved and its case history is locked.";
  if (m.includes("payout_not_safely_reversible")) {
    return "That payout may already have reached the provider. Record the case outcome without claiming the payout was stopped.";
  }
  if (m.includes("not_staff")) return "You do not have permission to manage disputes.";
  if (m.includes("transaction_not_found") || m.includes("dispute_not_found")) return "That case is no longer available.";
  return "BidBlitz could not update this dispute. Reload the page and try again.";
}

export async function openDisputeAction(input: unknown): Promise<DisputeActionResult> {
  const parsed = openSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid dispute." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sign in again." };

  const { data, error } = await supabase.rpc("open_transaction_dispute", {
    p_transaction_id: parsed.data.transactionId,
    p_reason: parsed.data.reason as DisputeReason,
    p_summary: parsed.data.summary,
  });

  if (error || typeof data !== "string") {
    return { ok: false, message: rpcMessage(error?.message ?? "") };
  }

  // In-app staff alerts are created transactionally in Postgres. Email is an
  // additional wake-up channel and deliberately cannot roll back the case.
  const admin = createAdminClient();
  const { data: dispute } = await admin
    .from("transaction_disputes")
    .select("transaction_id")
    .eq("id", data)
    .maybeSingle();
  const { data: tx } = dispute
    ? await admin
        .from("transactions")
        .select("auction_id")
        .eq("id", dispute.transaction_id)
        .maybeSingle()
    : { data: null };
  const { data: auction } = tx
    ? await admin.from("auctions").select("title").eq("id", tx.auction_id).maybeSingle()
    : { data: null };

  await notifyAdmins(
    "dispute_staff_required",
    {
      disputeId: data,
      transactionId: parsed.data.transactionId,
      title: auction?.title ?? "Sale",
    },
    emailKey("dispute_staff_required", "dispute", data),
    "disputes.manage"
  ).catch(() => undefined);

  revalidatePath("/dashboard/transactions");
  revalidatePath(`/dashboard/transactions/${parsed.data.transactionId}`);
  revalidatePath("/dashboard/disputes");
  revalidatePath("/admin");
  revalidatePath("/admin/disputes");
  return { ok: true, disputeId: data };
}

export async function addDisputeMessageAction(input: unknown): Promise<DisputeActionResult> {
  const parsed = messageSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid message." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sign in again." };

  const { error } = await supabase.rpc("add_transaction_dispute_message", {
    p_dispute_id: parsed.data.disputeId,
    p_body: parsed.data.body,
  });

  if (error) return { ok: false, message: rpcMessage(error.message) };

  revalidatePath(`/dashboard/disputes/${parsed.data.disputeId}`);
  revalidatePath(`/admin/disputes/${parsed.data.disputeId}`);
  revalidatePath("/admin/disputes");
  return { ok: true, disputeId: parsed.data.disputeId };
}

export async function updateDisputeAction(input: unknown): Promise<DisputeActionResult> {
  const parsed = staffUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid decision." };
  }

  const allowed = await hasPermission(
    (await (await createClient()).auth.getUser()).data.user?.id ?? "",
    "disputes.manage"
  );
  if (!allowed) return { ok: false, message: "You do not have permission to manage disputes." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("staff_update_transaction_dispute", {
    p_dispute_id: parsed.data.disputeId,
    p_status: parsed.data.status as DisputeStatus,
    p_resolution: (parsed.data.resolution ?? null) as DisputeResolution | null,
    p_payout_resolution:
      (parsed.data.payoutResolution ?? null) as DisputePayoutResolution | null,
    p_resolution_note: parsed.data.resolutionNote ?? null,
  });

  if (error) return { ok: false, message: rpcMessage(error.message) };

  revalidatePath("/admin");
  revalidatePath("/admin/disputes");
  revalidatePath(`/admin/disputes/${parsed.data.disputeId}`);
  revalidatePath("/dashboard/disputes");
  revalidatePath(`/dashboard/disputes/${parsed.data.disputeId}`);
  return { ok: true, disputeId: parsed.data.disputeId };
}

const EVIDENCE_MAX_BYTES = 5 * 1024 * 1024;
const EVIDENCE_MAX_PER_CASE = 8;

function evidenceMime(ext: string): string | null {
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    default:
      return null;
  }
}

export async function uploadDisputeEvidenceAction(
  formData: FormData
): Promise<DisputeActionResult> {
  const disputeId = String(formData.get("disputeId") ?? "");
  if (!z.string().uuid().safeParse(disputeId).success) {
    return { ok: false, message: "Invalid dispute." };
  }

  const file = formData.get("evidence");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Choose an image first." };
  }
  if (file.size > EVIDENCE_MAX_BYTES) {
    return { ok: false, message: "Evidence images must be 5 MB or smaller." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sign in again." };

  const admin = createAdminClient();
  const { data: dispute } = await admin
    .from("transaction_disputes")
    .select("id, transaction_id, status")
    .eq("id", disputeId)
    .maybeSingle();
  if (!dispute) return { ok: false, message: "That dispute is not available." };
  if (dispute.status === "RESOLVED") {
    return { ok: false, message: "This dispute is resolved and its evidence record is locked." };
  }

  const { data: tx } = await admin
    .from("transactions")
    .select("buyer_id, seller_id")
    .eq("id", dispute.transaction_id)
    .maybeSingle();
  const staff = await hasPermission(user.id, "disputes.manage");
  if (!tx || (user.id !== tx.buyer_id && user.id !== tx.seller_id && !staff)) {
    return { ok: false, message: "You do not have access to this dispute." };
  }

  const { count } = await admin
    .from("transaction_dispute_evidence")
    .select("id", { count: "exact", head: true })
    .eq("dispute_id", disputeId);
  if ((count ?? 0) >= EVIDENCE_MAX_PER_CASE) {
    return { ok: false, message: "This case already has the maximum of 8 evidence images." };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const validated = validateAvatarBytes(bytes);
  if (!validated.ok) {
    return { ok: false, message: "Use a real JPEG, PNG, WebP or GIF image." };
  }
  const mime = evidenceMime(validated.ext);
  if (!mime) return { ok: false, message: "That image type is not supported." };

  const storagePath = `${disputeId}/${user.id}/${randomUUID()}.${validated.ext}`;
  const { error: uploadError } = await admin.storage
    .from("dispute-evidence")
    .upload(storagePath, bytes, {
      contentType: mime,
      cacheControl: "0",
      upsert: false,
    });
  if (uploadError) {
    console.error("[disputes] evidence upload failed", uploadError.message);
    return { ok: false, message: "BidBlitz could not upload that evidence image." };
  }

  const { error: insertError } = await admin
    .from("transaction_dispute_evidence")
    .insert({
      dispute_id: disputeId,
      uploaded_by: user.id,
      storage_path: storagePath,
      mime_type: mime,
      size_bytes: file.size,
    });
  if (insertError) {
    await admin.storage.from("dispute-evidence").remove([storagePath]);
    console.error("[disputes] evidence record failed", insertError.message);
    return { ok: false, message: "BidBlitz could not record that evidence image." };
  }

  revalidatePath(`/dashboard/disputes/${disputeId}`);
  revalidatePath(`/admin/disputes/${disputeId}`);
  return { ok: true, disputeId };
}
