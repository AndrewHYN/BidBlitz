"use client";

import { useState } from "react";

/**
 * `<img>` that degrades to `fallback` when the src is missing or fails to
 * load. A row in `auction_images` can outlive its object (deletes, migrations,
 * harness fixtures), and a broken-image glyph on a live card is not an
 * acceptable product state — the audit rule is "broken images" get a real
 * error/empty state.
 *
 * Supabase public bucket; plain img keeps remote-pattern config out of the
 * build.
 */
export function ImageWithFallback({
  src,
  alt,
  className,
  loading,
  fallback,
}: {
  src: string | null;
  alt: string;
  className?: string;
  loading?: "lazy" | "eager";
  fallback: React.ReactNode;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (!src || failedSrc === src) return <>{fallback}</>;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading={loading}
      ref={node => {
        // A cached 404 can finish before React attaches its error listener.
        if (node?.complete && node.naturalWidth === 0) setFailedSrc(src);
      }}
      onError={() => setFailedSrc(src)}
      className={className}
    />
  );
}
