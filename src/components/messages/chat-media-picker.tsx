"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AudioLines, ImagePlus, Mic, Square, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CHAT_AUDIO_TYPES, CHAT_IMAGE_TYPES, CHAT_MEDIA_LIMIT, chatMediaType } from "@/lib/chat-media";

export function ChatMediaPicker({ file, disabled, onFile, onError, onRecording }: {
  file: File | null;
  disabled: boolean;
  onFile: (file: File | null) => void;
  onError: (error: string | null) => void;
  onRecording: (recording: boolean) => void;
}) {
  const image = useRef<HTMLInputElement>(null);
  const audio = useRef<HTMLInputElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<number>(undefined);
  const mounted = useRef(false);
  const [status, setStatus] = useState<"idle" | "starting" | "recording">("idle");
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

  function select(selected?: File) {
    if (!selected) return;
    if (!chatMediaType(selected.type)) return onError("Choose a JPEG, PNG, WebP or supported audio file.");
    if (selected.size > CHAT_MEDIA_LIMIT) return onError("Choose a file under 3 MB.");
    onError(null);
    onFile(selected);
    setShowAudio(false);
  }

  async function record() {
    setShowAudio(false);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      return onError("Voice recording isn’t available here. You can attach an audio file.");
    }
    onError(null);
    onRecording(true);
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
        onRecording(false);
        if (!failed && chunks.length) {
          const type = recording.mimeType || chunks[0].type;
          select(new File(chunks, "Voice message", { type }));
        }
      };
      recording.start();
      setStatus("recording");
      timer.current = window.setTimeout(() => {
        if (recording.state === "recording") recording.stop();
      }, 60_000);
    } catch {
      stream.current?.getTracks().forEach(track => track.stop());
      stream.current = null;
      if (!mounted.current) return;
      setStatus("idle");
      onRecording(false);
      onError("Couldn’t access the microphone. Allow it in your browser or attach an audio file.");
    }
  }

  return (
    <div className="relative flex shrink-0 items-center gap-0.5">
      <input ref={image} type="file" accept={CHAT_IMAGE_TYPES.join(",")} hidden
        onChange={event => { select(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} />
      <input ref={audio} type="file" accept={[...CHAT_AUDIO_TYPES, ".m4a", ".wav"].join(",")} hidden
        onChange={event => { select(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} />
      <Button type="button" size="icon" variant="ghost" className="size-11 text-blue-600 dark:text-blue-400"
        aria-label="Attach photo" title="Attach photo" disabled={disabled || active} onClick={() => { setShowAudio(false); image.current?.click(); }}>
        <ImagePlus aria-hidden />
      </Button>
      <Button type="button" size="icon" variant="ghost" className={active ? "size-11 text-destructive" : "size-11 text-blue-600 dark:text-blue-400"}
        aria-label={status === "recording" ? "Stop recording" : "Audio options"}
        title={status === "recording" ? "Stop recording" : "Audio options"}
        aria-expanded={status === "idle" ? showAudio : undefined}
        disabled={disabled || status === "starting"}
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
      <span className="sr-only" role="status">{status === "recording" ? "Recording voice, up to one minute." : status === "starting" ? "Waiting for microphone." : ""}</span>
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
