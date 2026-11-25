/**
 * Client-side photo preparation. No third-party image transformation service.
 * Keep already-small photos unchanged (including animated formats); refuse
 * oversized GIFs rather than silently flatten animation. Never upload a large
 * original after compression fails.
 */
export const PHOTO_SOURCE_LIMIT = 20 * 1024 * 1024;
export const PHOTO_BUDGETS = {
  listing: { maxEdge: 1600, targetBytes: 200_000, maxBytes: 350_000, minEdge: 960 },
  avatar: { maxEdge: 384, targetBytes: 35_000, maxBytes: 50_000, minEdge: 192 },
  chat: { maxEdge: 1280, targetBytes: 180_000, maxBytes: 350_000, minEdge: 720 },
} as const;
export type PhotoKind = keyof typeof PHOTO_BUDGETS;

export function fitPhoto(width: number, height: number, edge: number) {
  if (![width, height, edge].every(n => Number.isFinite(n) && n > 0)) throw new Error("Invalid image dimensions");
  const ratio = Math.min(1, edge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}

export async function preparePhoto(file: File, kind: PhotoKind): Promise<File> {
  const budget = PHOTO_BUDGETS[kind];
  if (!file.size || file.size > PHOTO_SOURCE_LIMIT) throw new Error("Choose a photo under 20 MB.");
  if (file.size <= budget.targetBytes) return file;
  if (file.type === "image/gif") {
    if (file.size <= budget.maxBytes) return file;
    throw new Error("Choose a smaller animated GIF or a still photo.");
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (image.naturalWidth * image.naturalHeight > 60_000_000) throw new Error("Photo dimensions are too large.");
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Image preparation is unavailable.");
    let best: Blob | null = null;
    let edge = budget.maxEdge as number;
    for (;;) {
      const size = fitPhoto(image.naturalWidth, image.naturalHeight, edge);
      canvas.width = size.width;
      canvas.height = size.height;
      ctx.drawImage(image, 0, 0, size.width, size.height);
      for (const quality of [0.84, 0.76, 0.68, 0.60]) {
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/webp", quality));
        if (!blob || blob.type !== "image/webp") throw new Error("This browser cannot optimize this photo.");
        if (!best || blob.size < best.size) best = blob;
        if (blob.size <= budget.targetBytes) {
          return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".webp", { type: blob.type });
        }
      }
      if (edge <= budget.minEdge) break;
      edge = Math.max(budget.minEdge, Math.floor(edge * 0.8));
    }
    if (file.size <= budget.maxBytes && (!best || file.size <= best.size)) return file;
    if (!best || best.size > budget.maxBytes) throw new Error("This photo could not be compressed enough. Choose a smaller photo.");
    return new File([best], file.name.replace(/\.[^.]+$/, "") + ".webp", { type: best.type });
  } finally {
    URL.revokeObjectURL(url);
  }
}
