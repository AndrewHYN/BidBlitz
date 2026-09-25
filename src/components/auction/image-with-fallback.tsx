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
  const [failed, setFailed] = useState(false);

  if (!src || failed) return <>{fallback}</>;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading={loading}
      onError={() => setFailed(true)}
      className={className}
    />
  );
}
