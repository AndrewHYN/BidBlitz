"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AudioLines, ImagePlus, Mic, Square, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CHAT_AUDIO_TYPES, CHAT_IMAGE_TYPES, CHAT_MEDIA_LIMIT, chatMediaType } from "@/lib/chat-media";
import { preparePhoto, PHOTO_SOURCE_LIMIT } from "@/lib/prepare-photo";

export type ChatMediaStatus = "idle" | "preparing" | "starting" | "recording";

export function ChatMediaPicker({ file, disabled, onFile, onError, onStatus }: {
  file: File | null;
  disabled: boolean;
  onFile: (file: File | null) => void;
  onError: (error: string | null) => void;
  onStatus: (status: ChatMediaStatus) => void;
}) {
  const image = useRef<HTMLInputElement>(null);
  const audio = useRef<HTMLInputElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<number>(undefined);
  const mounted = useRef(false);
  const [status, setStatus] = useState<ChatMediaStatus>("idle");
  const [showAudio, setShowAudio] = useState(false);
  const active = status !== "idle";

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      window.clearTimeout(timer.current);
      if (recorder.current?.state === "recording") recorder.current.stop();
      stream.current?.getTracks().forEach(track => track.stop());
    };
  }, []);

  async function select(selected: File) {
    const media = chatMediaType(selected.type);
    if (!media) return onError("Choose a JPEG, PNG, WebP or supported audio file.");
    if (selected.size > (media.kind === "image" ? PHOTO_SOURCE_LIMIT : CHAT_MEDIA_LIMIT)) return onError("Choose a photo under 20 MB or audio under 3 MB.");
    setStatus("preparing");
    onStatus("preparing");
    onError(null);
    try {
      // Mobile pickers can supply a temporary file handle. Keep the bytes in
      // memory before clearing the input so preview, send and retry share them.
      const bytes = await selected.arrayBuffer();
      if (bytes.byteLength !== selected.size || !bytes.byteLength) throw new Error("Unreadable file");
      if (mounted.current) {
        const copied = new File([bytes], selected.name, { type: selected.type });
        const prepared = media.kind === "image" ? await preparePhoto(copied, "chat") : copied;
        if (mounted.current) { onFile(prepared); setShowAudio(false); }
      }
    } catch {
      if (mounted.current) onError("Couldn’t read that file. Choose it again from your device.");
    } finally {
      if (mounted.current) {
        setStatus("idle");
        onStatus("idle");
      }
    }
  }

  async function choose(input: HTMLInputElement) {
    const selected = input.files?.[0];
    if (selected) await select(selected);
    input.value = "";
  }

  async function record() {
    setShowAudio(false);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      return onError("Voice recording isn’t available here. You can attach an audio file.");
    }
    onError(null);
    onStatus("starting");
    setStatus("starting");
    try {
      const input = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current) {
        input.getTracks().forEach(track => track.stop());
        return;
      }
      stream.current = input;
      const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"]
        .find(type => MediaRecorder.isTypeSupported(type));
      const recording = new MediaRecorder(input, { ...(mimeType && { mimeType }), audioBitsPerSecond: 48000 });
      recorder.current = recording;
      const chunks: Blob[] = [];
      let failed = false;
      recording.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recording.onerror = () => {
        failed = true;
        if (mounted.current) onError("Recording stopped unexpectedly. Try again.");
      };
      recording.onstop = () => {
        window.clearTimeout(timer.current);
        input.getTracks().forEach(track => track.stop());
        stream.current = null;
        recorder.current = null;
        if (!mounted.current) return;
        setStatus("idle");
        onStatus("idle");
        if (!failed && chunks.length) {
          const type = recording.mimeType || chunks[0].type;
          void select(new File(chunks, "Voice message", { type }));
        }
      };
      recording.start();
      setStatus("recording");
      onStatus("recording");
      timer.current = window.setTimeout(() => {
        if (recording.state === "recording") recording.stop();
      }, 60_000);
    } catch {
      stream.current?.getTracks().forEach(track => track.stop());
      stream.current = null;
      if (!mounted.current) return;
      setStatus("idle");
      onStatus("idle");
      onError("Couldn’t access the microphone. Allow it in your browser or attach an audio file.");
    }
  }

  return (
    <div className="relative flex shrink-0 items-center gap-0.5">
      <input ref={image} type="file" accept={CHAT_IMAGE_TYPES.join(",")} hidden
        onChange={event => void choose(event.currentTarget)} />
      <input ref={audio} type="file" accept={[...CHAT_AUDIO_TYPES, ".m4a", ".wav"].join(",")} hidden
        onChange={event => void choose(event.currentTarget)} />
      <Button type="button" size="icon" variant="ghost" className="size-11 text-blue-600 dark:text-blue-400"
        aria-label="Attach photo" title="Attach photo" disabled={disabled || active} onClick={() => { setShowAudio(false); image.current?.click(); }}>
        <ImagePlus aria-hidden />
      </Button>
      <Button type="button" size="icon" variant="ghost" className={active ? "size-11 text-destructive" : "size-11 text-blue-600 dark:text-blue-400"}
        aria-label={status === "recording" ? "Stop recording" : "Audio options"}
        title={status === "recording" ? "Stop recording" : "Audio options"}
        aria-expanded={status === "idle" ? showAudio : undefined}
        disabled={disabled || status === "starting" || status === "preparing"}
        onClick={() => {
          if (recorder.current?.state === "recording") recorder.current.stop();
          else setShowAudio(!showAudio);
        }}>
        {status === "recording" ? <Square aria-hidden /> : <Mic aria-hidden />}
      </Button>
      {showAudio && !disabled && (
        <div className="absolute bottom-full left-0 z-10 mb-2 flex w-48 flex-col rounded-xl border bg-popover p-1 shadow-md">
          <Button type="button" variant="ghost" className="justify-start" onClick={() => void record()}><Mic aria-hidden /> Record voice</Button>
          <Button type="button" variant="ghost" className="justify-start" onClick={() => { setShowAudio(false); audio.current?.click(); }}><Upload aria-hidden /> Attach audio</Button>
        </div>
      )}
      {file && <span className="sr-only">Attachment ready to send.</span>}
    </div>
  );
}

export function ChatMediaPreview({ file, disabled, onRemove }: { file: File; disabled: boolean; onRemove: () => void }) {
  const previewRef = useCallback((node: HTMLImageElement | HTMLAudioElement | null) => {
    if (!node) return;
    const url = URL.createObjectURL(file);
    node.src = url;
    return () => {
      node.removeAttribute("src");
      URL.revokeObjectURL(url);
    };
  }, [file]);
  const isImage = chatMediaType(file.type)?.kind === "image";
  return (
    <div className="mb-2 flex items-center gap-2 rounded-lg border p-2" aria-label="Attachment preview">
      {isImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img ref={previewRef} alt="Photo ready to send" className="size-12 rounded-lg object-cover" />
      ) : <AudioLines className="size-5 shrink-0" aria-hidden />}
      {isImage ? <span className="min-w-0 flex-1 truncate text-sm">Photo ready to send</span>
        : <audio controls preload="metadata" ref={previewRef} className="h-10 min-w-0 flex-1" aria-label="Preview audio" />}
      <Button type="button" size="icon" variant="ghost" aria-label="Remove attachment" disabled={disabled} onClick={onRemove}><X aria-hidden /></Button>
    </div>
  );
}
