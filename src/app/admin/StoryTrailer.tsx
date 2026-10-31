"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { saveTrailer, trailerUploadPass } from "./actions";

const TYPES: Record<string, string> = { mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime" };

/**
 * The story's trailer (owner, 31 Oct 2026: "What will be in the lobby, story trailer, I will create that, and there
 * should be a place for me to upload it"): an Upload button for the video, sent straight to Storage, and the trailer as
 * the lobby will show it.
 */
export function StoryTrailer({ hunt, url: initial }: { hunt: string; url: string | null }) {
  const [url, setUrl] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);
    const ext = (file.name.split(".").pop() ?? "").toLowerCase();
    if (!TYPES[ext]) return setError("Upload an MP4, WebM or MOV video.");
    if (file.size > 50 * 1024 * 1024) return setError("That video is over 50 MB: export it smaller (720p or 1080p, under a minute or two).");
    setBusy(true);
    try {
      const pass = await trailerUploadPass(hunt, ext);
      if ("error" in pass) throw new Error(pass.error);
      const { error: sent } = await createClient().storage.from("story-trailers").uploadToSignedUrl(pass.path, pass.token, file, { contentType: TYPES[ext] });
      if (sent) throw new Error(sent.message);
      const saved = await saveTrailer(hunt, pass.path);
      if ("error" in saved && saved.error) throw new Error(saved.error);
      setUrl("url" in saved ? (saved.url ?? null) : null);
    } catch (e) {
      setError(`Trailer: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl bg-ink-2 p-4" aria-label="Story trailer">
      <div>
        <p className="font-bold">
          🎬 The story&apos;s trailer <span className="text-muted">({url ? "uploaded: in the lobby" : "not uploaded yet"})</span>
        </p>
        <p className="text-xs text-muted">Shown on the hunt in the lobby, before and during the hunt. MP4, WebM or MOV, up to 50 MB.</p>
      </div>
      {error && <p className="rounded-lg bg-danger/10 p-2 text-sm text-danger-text ring-1 ring-danger">{error}</p>}
      {url && <video src={url} controls playsInline preload="metadata" className="aspect-video w-full max-w-md rounded-xl bg-ink" />}
      <label className={`flex h-10 w-fit cursor-pointer items-center rounded-xl px-4 text-sm font-bold ${url ? "border border-line" : "bg-gold text-ink"}`}>
        {busy ? "Uploading…" : url ? "Replace the trailer" : "Upload the trailer"}
        <input
          type="file"
          accept="video/mp4,video/webm,video/quicktime"
          className="sr-only"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void upload(file);
          }}
        />
      </label>
    </section>
  );
}
