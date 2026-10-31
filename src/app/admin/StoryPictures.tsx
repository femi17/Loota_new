"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { pictureUploadPass, savePicture } from "./actions";

export type StoryPicture = { n: number; chapter: number; prompt: string; url: string | null };

/**
 * The story's pictures (owner, 31 Oct 2026: "I should get a prompt for image generation for the story… and where I will
 * upload it to"): each scene's prompt to paste into ChatGPT, a Copy button, and an Upload button for the picture it
 * makes (sent straight to Storage). Uploaded pictures show here.
 */
export function StoryPictures({ hunt, pictures }: { hunt: string; pictures: StoryPicture[] }) {
  const [urls, setUrls] = useState<Record<number, string | null>>(() => Object.fromEntries(pictures.map((p) => [p.n, p.url])));
  const [busy, setBusy] = useState<number | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const done = Object.values(urls).filter(Boolean).length;

  async function upload(n: number, file: File) {
    setError(null);
    const ext = (file.name.split(".").pop() ?? "").toLowerCase();
    if (!/^(png|jpe?g|webp)$/.test(ext)) return setError("Upload a PNG, JPG or WebP picture.");
    if (file.size > 20 * 1024 * 1024) return setError("That picture is over 20 MB.");
    setBusy(n);
    try {
      const pass = await pictureUploadPass(hunt, n, ext);
      if ("error" in pass) throw new Error(pass.error);
      const { error: sent } = await createClient().storage.from("story-pictures").uploadToSignedUrl(pass.path, pass.token, file, { contentType: file.type });
      if (sent) throw new Error(sent.message);
      const saved = await savePicture(hunt, n, pass.path);
      if ("error" in saved && saved.error) throw new Error(saved.error);
      setUrls((u) => ({ ...u, [n]: "url" in saved ? (saved.url ?? null) : null }));
    } catch (e) {
      setError(`Picture ${n}: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <details className="rounded-2xl bg-ink-2 p-4" open={done < pictures.length}>
      <summary className="cursor-pointer font-bold">
        🎨 The story&apos;s pictures <span className="text-muted">({done} of {pictures.length} uploaded)</span>
      </summary>
      <p className="mt-2 text-xs text-muted">Copy a prompt, paste it into ChatGPT, then upload the picture it makes here (PNG, JPG or WebP, up to 20 MB).</p>
      {error && <p className="mt-2 rounded-lg bg-danger/10 p-2 text-sm text-danger-text ring-1 ring-danger">{error}</p>}
      <ol className="mt-3 flex flex-col gap-3">
        {pictures.map((p) => (
          <li key={p.n} className="flex flex-col gap-3 rounded-xl bg-ink p-3 sm:flex-row" data-picture={p.n}>
            <div className="flex aspect-video w-full shrink-0 items-center justify-center overflow-hidden rounded-lg bg-ink-2 text-xs text-muted sm:w-48">
              {/* eslint-disable-next-line @next/next/no-img-element -- an uploaded picture from Storage, any size */}
              {urls[p.n] ? <img src={urls[p.n]!} alt={`Picture ${p.n}`} className="size-full object-cover" /> : busy === p.n ? "Uploading…" : "No picture yet"}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <p className="text-xs font-bold text-gold">
                Picture {p.n} · chapter {p.chapter}
              </p>
              <p className="whitespace-pre-wrap text-sm text-paper/90">{p.prompt}</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(p.prompt);
                    setCopied(p.n);
                    setTimeout(() => setCopied((c) => (c === p.n ? null : c)), 2000);
                  }}
                  className="h-9 rounded-lg border border-line px-3 text-xs font-bold"
                >
                  {copied === p.n ? "✓ Copied" : "Copy prompt"}
                </button>
                <label className={`flex h-9 cursor-pointer items-center rounded-lg px-3 text-xs font-bold ${urls[p.n] ? "border border-line" : "bg-gold text-ink"}`}>
                  {urls[p.n] ? "Replace picture" : "Upload picture"}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="sr-only"
                    disabled={busy !== null}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (file) void upload(p.n, file);
                    }}
                  />
                </label>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </details>
  );
}
