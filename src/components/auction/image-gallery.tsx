"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, ImageIcon, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { ImageWithFallback } from "@/components/auction/image-with-fallback";

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
  const [viewerOpen, setViewerOpen] = useState(false);

  if (imageCount === 0 || images.length === 0) {
    return (
      <div
        data-testid="auction-gallery"
        className="grid aspect-[4/3] max-h-[min(58vh,560px)] w-full place-items-center rounded-xl border border-dashed bg-muted/40 text-center"
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
  const move = (direction: number) => setIndex((current) => (
    (Math.min(current, images.length - 1) + direction + images.length) % images.length
  ));

  return (
    <div data-testid="auction-gallery" className="space-y-3">
      {/*
        Media frame: bordered, rounded, and inset. The photo is CONTAINED
        inside visible padding rather than cropped to fill, so a seller's whole
        image is always readable — and the frame's height is capped so a large
        photo can never take over the viewport, while the width stays full on
        every screen. The box, not the image, owns the height: switching photos
        or hitting a broken one changes nothing about the layout.
      */}
      <div className="relative overflow-hidden rounded-xl border bg-muted/40 shadow-xs">
        <Dialog open={viewerOpen} onOpenChange={setViewerOpen}>
          <DialogTrigger asChild>
            <a
              href={active.url}
              target="_blank"
              rel="noopener"
              aria-label="View full-size photos"
              className="group absolute inset-0 z-10 cursor-zoom-in rounded-xl focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-ring"
              onClick={(event) => {
                // Before hydration the href already opens the full image.
                event.preventDefault();
                setViewerOpen(true);
              }}
            >
              <span className="absolute right-2 top-2 grid size-10 place-items-center rounded-lg border bg-card/95 shadow-sm group-hover:bg-card">
                <Maximize2 className="size-4" aria-hidden />
              </span>
            </a>
          </DialogTrigger>
          <DialogContent aria-describedby={undefined}
            className="max-h-dvh max-w-[calc(100%-1rem)] sm:max-w-5xl"
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") move(-1);
              if (event.key === "ArrowRight") move(1);
            }}>
            <DialogTitle className="pr-9">{title}</DialogTitle>
            <div className="grid h-[min(70dvh,calc(100dvh-10rem))] place-items-center overflow-hidden rounded-lg bg-muted">
              <ImageWithFallback key={active.id} src={active.url}
                alt={`${title}, photo ${activeIndex + 1} of ${images.length}`}
                className="size-full min-h-0 object-contain"
                fallback={<p className="text-muted-foreground">Photo unavailable</p>} />
            </div>
            <div className="flex items-center justify-center gap-4">
              <Button type="button" variant="outline" size="icon" aria-label="Previous photo" disabled={images.length < 2} onClick={() => move(-1)}>
                <ChevronLeft aria-hidden />
              </Button>
              <span aria-live="polite">{activeIndex + 1} / {images.length}</span>
              <Button type="button" variant="outline" size="icon" aria-label="Next photo" disabled={images.length < 2} onClick={() => move(1)}>
                <ChevronRight aria-hidden />
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        <div className="flex aspect-[4/3] max-h-[min(58vh,560px)] w-full items-center justify-center p-3 sm:p-4 md:p-5">
          {/* key by photo: a failed load must reset when the user switches. */}
          <ImageWithFallback
            key={active.id}
            src={active.url}
            alt={`${title}, photo ${activeIndex + 1} of ${images.length}`}
            responsive={{ width: 960, height: 720, sizes: "(min-width: 1024px) 54vw, 100vw" }}
            className="size-full object-contain"
            fallback={
              <div className="grid size-full place-items-center rounded-lg border border-dashed bg-background/60 text-center">
                <div className="space-y-2 px-6 py-8">
                  <ImageIcon className="mx-auto size-8 text-muted-foreground/60" aria-hidden />
                  <p className="text-sm font-medium">Photo unavailable</p>
                  <p className="text-xs text-muted-foreground">
                    This listing&apos;s image could not be loaded.
                  </p>
                </div>
              </div>
            }
          />
        </div>
        <span className="pointer-events-none absolute right-2 bottom-2 rounded-md bg-background/90 px-2 py-0.5 text-xs tabular-nums backdrop-blur-sm">
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
              <ImageWithFallback
                key={img.id}
                src={img.url}
                responsive={{ width: 64, height: 64 }}
                alt=""
                className="size-full object-cover"
                fallback={
                  <div className="grid size-full place-items-center bg-muted">
                    <ImageIcon className="size-4 text-muted-foreground/60" aria-hidden />
                  </div>
                }
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
