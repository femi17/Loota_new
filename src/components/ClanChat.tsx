"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Message = { id: number; body: string; at: string; by: string | null; mine: boolean };

/** The clan's chat (owner, 31 Oct 2026: clanmates share clues and plans): new messages every few seconds. */
export function ClanChat({ className = "" }: { className?: string }) {
  const [supabase] = useState(createClient);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const last = useRef(0);
  const list = useRef<HTMLOListElement>(null);

  useEffect(() => {
    let live = true;
    const pull = async () => {
      const { data } = await supabase.rpc("clan_chat", { p_after: last.current });
      const r = data as { ok: boolean; messages?: Message[] } | null;
      if (!live || !r?.ok || !r.messages?.length) return;
      last.current = r.messages[r.messages.length - 1].id;
      setMessages((m) => [...m, ...r.messages!].slice(-120));
      requestAnimationFrame(() => list.current?.scrollTo({ top: list.current.scrollHeight }));
    };
    void pull();
    const t = setInterval(pull, 4000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [supabase]);

  async function send() {
    const body = text.trim();
    if (!body) return;
    setText("");
    const { data } = await supabase.rpc("clan_say", { p_body: body });
    const r = data as { ok: boolean; reason?: string } | null;
    if (!r?.ok) {
      setText(body);
      setNote(r?.reason === "slow" ? "Slow down a little." : "Couldn't send that.");
      return;
    }
    setNote(null);
    const { data: more } = await supabase.rpc("clan_chat", { p_after: last.current });
    const m = more as { ok: boolean; messages?: Message[] } | null;
    if (m?.ok && m.messages?.length) {
      last.current = m.messages[m.messages.length - 1].id;
      setMessages((old) => [...old, ...m.messages!].slice(-120));
      requestAnimationFrame(() => list.current?.scrollTo({ top: list.current.scrollHeight }));
    }
  }

  return (
    <section className={`flex min-h-0 flex-col gap-2 ${className}`} aria-label="Clan chat">
      <ol ref={list} className="flex min-h-[8rem] flex-1 flex-col gap-1.5 overflow-y-auto rounded-xl bg-ink p-3 text-sm">
        {messages.length === 0 && <li className="text-muted">No messages yet. Share a clue, a plan, a warning.</li>}
        {messages.map((m) => (
          <li key={m.id} className={`max-w-[85%] rounded-2xl px-3 py-1.5 ${m.mine ? "self-end bg-gold text-ink" : "self-start bg-ink-2"}`}>
            {!m.mine && <span className="block text-[11px] font-bold opacity-70">{m.by ?? "Someone"}</span>}
            {m.body}
          </li>
        ))}
      </ol>
      {note && <p className="text-xs text-danger-text">{note}</p>}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder="Say something to your clan" aria-label="Message" className="h-11 min-w-0 flex-1 rounded-xl border-[1.5px] border-line bg-ink px-3 text-sm text-paper outline-none focus:border-gold" />
        <button type="submit" className="h-11 shrink-0 rounded-xl bg-gold px-4 text-sm font-bold text-ink">
          Send
        </button>
      </form>
    </section>
  );
}
