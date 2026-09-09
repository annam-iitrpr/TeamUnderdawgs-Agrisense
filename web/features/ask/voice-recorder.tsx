"use client";

/**
 * Record a spoken question.
 *
 * The recording is sent to the model as audio; nothing is transcribed on this
 * device. A farmer may speak any of the supported languages and the answer
 * comes back in the language they used.
 *
 * If the browser will not give a microphone, or the device has none, the
 * control says so and typing still works. It never silently discards audio.
 */
import { Button } from "@/components/ui";
import { Mic, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

/** Ordered by what a browser is most likely to actually produce. */
const CANDIDATE_TYPES = ["audio/webm", "audio/ogg", "audio/mp4"] as const;
export const MAX_RECORDING_MS = 60_000;

function supportedType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  return CANDIDATE_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? null;
}

export function VoiceRecorder({
  disabled,
  onRecorded,
  onError,
}: {
  disabled?: boolean;
  onRecorded: (file: File) => void;
  onError: (message: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);

  const cleanup = useCallback(() => {
    if (stopTimer.current) clearTimeout(stopTimer.current);
    if (tick.current) clearInterval(tick.current);
    stopTimer.current = null;
    tick.current = null;
    recorder.current?.stream.getTracks().forEach((t) => t.stop());
    recorder.current = null;
    setRecording(false);
    setElapsed(0);
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const stop = useCallback(() => {
    if (recorder.current?.state === "recording") recorder.current.stop();
  }, []);

  async function start() {
    const mimeType = supportedType();
    if (!mimeType || !navigator.mediaDevices?.getUserMedia) {
      onError("This browser cannot record audio. You can still type your question.");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      onError("AgriSense needs permission to use the microphone. You can still type instead.");
      return;
    }
    const chunks: Blob[] = [];
    const rec = new MediaRecorder(stream, { mimeType });
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    rec.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType });
      cleanup();
      if (blob.size === 0) {
        onError("Nothing was recorded. Check the microphone and try again.");
        return;
      }
      // The extension follows the type so the server's own check agrees with it.
      const ext = mimeType.split("/")[1]?.split(";")[0] ?? "webm";
      onRecorded(new File([blob], `question.${ext}`, { type: mimeType }));
    };
    recorder.current = rec;
    rec.start();
    setRecording(true);
    tick.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    // A recording that runs forever is a file nobody can upload.
    stopTimer.current = setTimeout(stop, MAX_RECORDING_MS);
  }

  if (recording) {
    return (
      <Button type="button" variant="secondary" onClick={stop} aria-label="Stop recording">
        <Square aria-hidden className="size-4 text-clay" />
        <span className="tabular-nums">{elapsed}s</span>
      </Button>
    );
  }

  return (
    <Button
      type="button"
      variant="secondary"
      size="lg"
      onClick={start}
      disabled={disabled}
      aria-label="Ask by voice"
    >
      <Mic aria-hidden className="size-4" />
    </Button>
  );
}
