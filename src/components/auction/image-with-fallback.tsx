"use client";

import { getImageProps } from "next/image";
import { useState } from "react";

/**
 * `<img>` that degrades to `fallback` when the src is missing or fails to
 * load. A row in `auction_images` can outlive its object (deletes, migrations,
 * harness fixtures), and a broken-image glyph on a live card is not an
 * acceptable product state — the audit rule is "broken images" get a real
 * error/empty state.
 *
 * For public listing photos, request a browser-selected size and retry the
 * original object if its optimized rendition is unavailable.
 */
export function ImageWithFallback({
  src,
  alt,
  className,
  loading,
  fallback,
  responsive,
}: {
  src: string | null;
  alt: string;
  className?: string;
  loading?: "lazy" | "eager";
  fallback: React.ReactNode;
  responsive?: { width: number; height: number; sizes?: string };
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  const [failedRendition, setFailedRendition] = useState<string | null>(null);
  if (!src || failedSrc === src) return <>{fallback}</>;

  const optimized = responsive && failedRendition !== src
    ? getImageProps({ src, alt, ...responsive }).props : null;
  function onFailure() {
    if (optimized) setFailedRendition(src);
    else setFailedSrc(src);
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      sizes={optimized?.sizes}
      srcSet={optimized?.srcSet}
      src={optimized?.src ?? src}
      alt={alt}
      loading={loading}
      ref={node => {
        // A cached 404 can finish before React attaches its error listener.
        if (node?.complete && node.naturalWidth === 0) onFailure();
      }}
      onError={onFailure}
      className={className}
    />
  );
}
