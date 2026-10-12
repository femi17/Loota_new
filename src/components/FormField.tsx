import type { InputHTMLAttributes } from "react";

export function FormField({
  label,
  hint,
  ...input
}: { label: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm text-muted">{label}</span>
      <input
        {...input}
        className="h-12 rounded-xl border-[1.5px] border-line bg-ink-2 px-4 text-base text-paper outline-none focus:border-gold"
      />
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function FormMessage({ error, message }: { error?: string; message?: string }) {
  if (error) {
    return (
      <p role="alert" className="rounded-xl border border-danger/60 bg-danger/10 px-4 py-3 text-sm text-danger-text">
        {error}
      </p>
    );
  }
  if (message) {
    return <p role="status" className="rounded-xl border border-gold/60 bg-gold/10 px-4 py-3 text-sm">{message}</p>;
  }
  return null;
}

export const primaryButton =
  "flex h-14 w-full items-center justify-center rounded-2xl bg-gold text-[17px] font-bold text-ink transition-colors hover:bg-gold-hover disabled:cursor-wait disabled:opacity-70";
