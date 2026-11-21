export const CHAT_MEDIA_LIMIT = 3 * 1024 * 1024;
export const CHAT_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const CHAT_AUDIO_TYPES = ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav"];

export function chatMediaType(value: string) {
  const mime = value.split(";")[0].trim().toLowerCase();
  if (CHAT_IMAGE_TYPES.includes(mime)) return { mime, kind: "image" as const };
  if (CHAT_AUDIO_TYPES.includes(mime)) return { mime, kind: "audio" as const };
  if (mime === "audio/x-wav" || mime === "audio/wave") return { mime: "audio/wav", kind: "audio" as const };
  if (mime === "audio/x-m4a") return { mime: "audio/mp4", kind: "audio" as const };
  return null;
}
