"use client";

import { createContext, useContext, useEffect, useState, type Dispatch, type SetStateAction } from "react";

/**
 * A puzzle board's answers, for the broadcast (owner, 9 Nov 2026: "the users answers in the 3d world is not displayed
 * to users"). Each board keeps what the hunter has put in (marks, a path, the grid, the words…) with useAnswer, named:
 * in the hunter's game the key's place records every change (`record`) for the broadcast; on the broadcast the same
 * board shows the answers recorded (`shown`) instead of its own.
 */
export const AnswerMirror = createContext<{ record?: (key: string, value: unknown) => void; shown?: Record<string, unknown> | null } | null>(null);

export function useAnswer<T>(key: string, init: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const mirror = useContext(AnswerMirror);
  const [value, set] = useState<T>(init);
  const record = mirror?.record;
  useEffect(() => record?.(key, value), [record, key, value]);
  const shown = mirror?.shown;
  return [shown && key in shown ? (shown[key] as T) : value, set];
}
