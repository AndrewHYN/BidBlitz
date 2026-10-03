import Image from "next/image";

/**
 * The canonical BidBlitz brand mark: white geometric B with the yellow bolt
 * on the dark navy rounded square, served from the supplied artwork
 * (`public/brand/bidblitz-logo*.png`).
 *
 * One component so every surface uses the same file, the same intrinsic
 * dimensions (no layout shift: width/height are always stated), and
 * deliberate alt text. Callers beside visible "BidBlitz" text pass `alt=""`
 * so screen readers do not hear the brand twice; standalone instances pass
 * `alt="BidBlitz"`.
 */
export function BrandMark({
  size = 32,
  alt = "",
  priority = false,
  className,
}: {
  /** Rendered CSS pixels; the file stays square so one number suffices. */
  size?: number;
  alt?: string;
  priority?: boolean;
  className?: string;
}) {
  return (
    <Image
      src="/brand/bidblitz-logo-96.png"
      alt={alt}
      width={size}
      height={size}
      priority={priority}
      className={className}
    />
  );
}
