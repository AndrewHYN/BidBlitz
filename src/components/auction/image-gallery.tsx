"use client";

import { useState } from "react";
import { ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Main image + thumbnail strip. The server hands over fully-resolved URLs so
 * this client component never needs the server-only query helpers.
 */
export type GalleryImage = {
  id: string;
  url: string;
  position: number;
};

export function ImageGallery({
  images,
  imageCount,
  title,
}: {
  images: GalleryImage[];
  imageCount: number;
  title: string;
}) {
  const [index, setIndex] = useState(0);

  if (imageCount === 0 || images.length === 0) {
    return (
      <div
        data-testid="auction-gallery"
        className="grid aspect-[4/3] place-items-center rounded-xl border border-dashed bg-muted/40 text-center"
      >
        <div className="space-y-2 px-6 py-8">
          <ImageIcon className="mx-auto size-8 text-muted-foreground/60" aria-hidden />
          <p className="text-sm font-medium">No photos yet</p>
          <p className="text-xs text-muted-foreground">
            The seller hasn&apos;t added images to this listing.
          </p>
        </div>
      </div>
    );
  }

  const activeIndex = Math.min(index, images.length - 1);
  const active = images[activeIndex];

  return (
    <div data-testid="auction-gallery" className="space-y-3">
      <div className="relative aspect-[4/3] overflow-hidden rounded-xl border bg-muted">
        {/* Supabase public bucket; plain img keeps remote-pattern config out of the build. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={active.url}
          alt={`${title} — photo ${activeIndex + 1} of ${images.length}`}
          className="size-full object-cover"
        />
        <span className="absolute right-2 bottom-2 rounded-md bg-background/90 px-2 py-0.5 text-xs tabular-nums backdrop-blur-sm">
          {activeIndex + 1} / {images.length}
        </span>
      </div>

      {images.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {images.map((img, i) => (
            <button
              key={img.id}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`Show photo ${i + 1} of ${images.length}`}
              aria-current={i === activeIndex}
              className={cn(
                "relative size-16 shrink-0 overflow-hidden rounded-lg border transition-all",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                i === activeIndex
                  ? "border-primary ring-2 ring-primary/30"
                  : "opacity-70 hover:opacity-100"
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.url} alt="" className="size-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
