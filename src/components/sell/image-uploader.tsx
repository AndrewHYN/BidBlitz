"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ImageIcon, XIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { attachImagesAction } from "@/server/actions/auction";
import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES, MAX_IMAGES } from "@/lib/validation";
import { formatMoney, money } from "@/lib/money";
import { renderRejectionMessage } from "@/server/errors";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * Photos for a draft.
 *
 * Uploads go browser -> Supabase Storage (RLS namespaces every object under
 * `<auction_id>/`), and only AFTER the bytes land do we hand the full, ordered
 * path list to `attachImagesAction` once — positions are computed from that
 * list, so per-file calls would race each other.
 *
 * Local `entries` state is seeded once from server props and then maintained
 * by hand; there is deliberately no synchronising `useEffect`, which would both
 * fight the render and trip the set-state-in-effect rule.
 */

const BUCKET = "auction-images";
const SUPPORTED_TYPES: readonly string[] = ALLOWED_IMAGE_TYPES;
const MAX_MB = Math.round(MAX_IMAGE_BYTES / (1024 * 1024));

export type UploaderImage = {
  key: string;
  storagePath: string;
  url: string;
};

/** Lowest file index not already used by this auction, so paths never collide. */
function lowestFreeIndex(list: UploaderImage[]): number {
  const used = new Set<number>();
  for (const entry of list) {
    const file = entry.storagePath.split("/").pop() ?? "";
    const parsed = Number.parseInt(file.split(".")[0] ?? "", 10);
    if (Number.isFinite(parsed)) used.add(parsed);
  }
  let index = 0;
  while (used.has(index)) index += 1;
  return index;
}

function extensionFor(file: File): string {
  const fromName = file.name.includes(".")
    ? file.name.slice(file.name.lastIndexOf(".") + 1)
    : "";
  const cleaned = fromName.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (cleaned) return cleaned;
  const fromType = file.type.split("/")[1] ?? "";
  return fromType.replace(/[^a-z0-9]/g, "") || "bin";
}

export function ImageUploader({
  auctionId,
  images,
}: {
  auctionId: string;
  images: UploaderImage[];
}) {
  const router = useRouter();
  const [entries, setEntries] = useState<UploaderImage[]>(() => images);
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const [inputKey, setInputKey] = useState(0);

  const full = entries.length >= MAX_IMAGES;

  function handleFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = ""; // let the same file be picked again after a failure
    if (files.length === 0) return;

    setNotice(null);

    const accepted: File[] = [];
    for (const file of files) {
      if (!SUPPORTED_TYPES.includes(file.type)) {
        setNotice(`“${file.name}” isn’t a supported image type.`);
        continue;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        setNotice(`“${file.name}” is larger than ${MAX_MB} MB.`);
        continue;
      }
      accepted.push(file);
    }

    const room = Math.max(0, MAX_IMAGES - entries.length);
    const usable = accepted.slice(0, room);
    if (usable.length === 0) {
      if (accepted.length > 0) setNotice(`You can add up to ${MAX_IMAGES} photos.`);
      setInputKey((key) => key + 1);
      return;
    }
    if (usable.length < accepted.length) {
      setNotice(`Only ${usable.length} of ${accepted.length} were added — the limit is ${MAX_IMAGES} photos.`);
    }

    startTransition(async () => {
      try {
        const supabase = createClient();
        const base = [...entries];
        const added: UploaderImage[] = [];

        for (const file of usable) {
          const storagePath = `${auctionId}/${lowestFreeIndex([...base, ...added])}.${extensionFor(file)}`;
          const { error } = await supabase.storage
            .from(BUCKET)
            .upload(storagePath, file, { upsert: true, contentType: file.type });
          if (error) {
            setNotice(`Couldn’t upload “${file.name}”: ${error.message}`);
            break;
          }
          const { data } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
          added.push({ key: storagePath, storagePath, url: data.publicUrl });
        }

        setInputKey((key) => key + 1);
        if (added.length === 0) return;

        const next = [...base, ...added];
        setEntries(next);

        const result = await attachImagesAction({
          auctionId,
          images: next.map((entry) => ({ storagePath: entry.storagePath })),
        });
        if (!result.ok) {
          setNotice(renderRejectionMessage(result.rejection, (minor) => formatMoney(money(minor))));
        }
        router.refresh();
      } catch {
        setNotice("Something went wrong while uploading. Please try again.");
      }
    });
  }

  function handleRemove(entry: UploaderImage) {
    setNotice(null);
    startTransition(async () => {
      try {
        const supabase = createClient();
        await supabase.storage.from(BUCKET).remove([entry.storagePath]);
        await supabase
          .from("auction_images")
          .delete()
          .eq("auction_id", auctionId)
          .eq("storage_path", entry.storagePath);

        setEntries((prev) => prev.filter((item) => item.key !== entry.key));

        // No client-side recount: auction_images changes recompute
        // auctions.image_count inside the database (sync_image_count trigger,
        // migration 000008), and clients hold no grant on that column.

        router.refresh();
      } catch {
        setNotice("Couldn’t remove that photo. Please try again.");
      }
    });
  }

  return (
    <div data-testid="image-uploader" className="space-y-4">
      {entries.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {entries.map((entry, index) => (
            <li
              key={entry.key}
              className="group relative aspect-[4/3] overflow-hidden rounded-lg border bg-muted"
            >
              {/* Supabase public bucket; plain img keeps remote-pattern config out of the build. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={entry.url}
                alt={`Photo ${index + 1} of ${entries.length}`}
                className="size-full object-cover"
              />
              <button
                type="button"
                data-testid="upload-remove"
                onClick={() => handleRemove(entry)}
                disabled={pending}
                aria-label={`Remove photo ${index + 1}`}
                title={`Remove photo ${index + 1}`}
                className={cn(
                  "absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-md",
                  "bg-background/85 text-foreground shadow-sm backdrop-blur-sm transition-colors",
                  "hover:bg-destructive/15 hover:text-destructive",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  "disabled:cursor-not-allowed disabled:opacity-50"
                )}
              >
                <XIcon className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="auction-photo-input">Add photos</Label>
        <input
          key={inputKey}
          id="auction-photo-input"
          type="file"
          accept={SUPPORTED_TYPES.join(",")}
          multiple
          onChange={handleFiles}
          disabled={pending || full}
          data-testid="upload-input"
          className={cn(
            "block w-full cursor-pointer rounded-lg border border-dashed bg-background px-3 py-2 text-sm",
            "text-muted-foreground file:mr-3 file:cursor-pointer file:rounded-md file:border file:bg-background",
            "file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-muted",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            "disabled:cursor-not-allowed disabled:opacity-50"
          )}
        />
        <p className="text-xs text-muted-foreground">
          {entries.length} of {MAX_IMAGES} photos · JPEG, PNG, WebP, AVIF or GIF up to {MAX_MB} MB each.
        </p>
      </div>

      {full && (
        <p className="text-xs text-muted-foreground">
          That&apos;s the {MAX_IMAGES}-photo limit. Remove one to add another.
        </p>
      )}

      {notice && (
        <p role="status" className="text-xs font-medium text-destructive">
          {notice}
        </p>
      )}

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <ImageIcon className="size-3.5 shrink-0" aria-hidden />
        <span>The first photo becomes the listing thumbnail.</span>
      </div>

      <Button type="button" variant="outline" size="sm" disabled={pending || full} className="sm:hidden"
        onClick={() => document.getElementById("auction-photo-input")?.click()}>
        {pending ? "Uploading…" : "Choose photos"}
      </Button>
    </div>
  );
}
