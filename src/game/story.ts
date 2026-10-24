/**
 * The hunt's story (owner, 24 Oct 2026: the villain is the Masquerade; the tone light and playful). Beats are told at
 * the start, after each key, at a relay chest and at the finish: a few lines from the Masquerade (a mischievous masked
 * dancer who hides the keys and moves them about), the Keeper (calm, on the hunter's side) and the narrator. A hunt can
 * have its own lines (hunt_story, written in /admin); otherwise these defaults, picked by the hunt and beat.
 */

export type StoryWho = "masquerade" | "keeper" | "narrator";
export type StoryLine = { who: StoryWho; text: string };
export type StoryBeat = "start" | "finish" | `key:${number}` | `relay:${number}`;

export const STORY_NAMES: Record<StoryWho, string> = { masquerade: "The Masquerade", keeper: "The Keeper", narrator: "" };

const START: StoryLine[][] = [
  [
    { who: "narrator", text: "The drums are beating. Somewhere in the city, the keys have been hidden…" },
    { who: "masquerade", text: "Hehehe! Welcome, welcome! I am the Masquerade, and I have hidden the keys myself. Well well!" },
    { who: "masquerade", text: "Riddles, puzzles, a few little surprises… Catch me if you can!" },
    { who: "keeper", text: "Don't mind him. Read the riddle, follow the heat, and trust your feet. Go!" },
  ],
  [
    { who: "narrator", text: "Dust swirls. Bells jingle. Someone in raffia is dancing where they shouldn't be…" },
    { who: "masquerade", text: "Ehen! Another hunter! You think you can find MY keys? Oya, let's see your legs!" },
    { who: "keeper", text: "Every key you win is one he can't hide again. The first riddle is yours." },
  ],
];

const KEY: StoryLine[][] = [
  [
    { who: "masquerade", text: "Ah-ah! You found that one? Beginner's luck, I'm telling you!" },
    { who: "masquerade", text: "The next one I hid with my own two hands. Good luck finding it… hehe." },
    { who: "keeper", text: "Well done. Don't stop now: the others are close behind." },
  ],
  [
    { who: "masquerade", text: "Wait, wait… who told you where that key was? Was it the pepper seller? It was the pepper seller!" },
    { who: "keeper", text: "Nobody told you. You worked it out. On to the next riddle." },
  ],
  [
    { who: "narrator", text: "Somewhere nearby, a masked figure stamps his feet in frustration." },
    { who: "masquerade", text: "Fine! FINE! Take it. But the next one has a puzzle so tricky, even I can't solve it." },
    { who: "keeper", text: "He says that every time. Keep going." },
  ],
  [
    { who: "masquerade", text: "Hmm. You're good. Too good. I don't like it." },
    { who: "masquerade", text: "I'll dance faster. I'll hide better. You'll see!" },
    { who: "keeper", text: "Let him dance. You hunt." },
  ],
];

const LAST_KEY: StoryLine[][] = [
  [
    { who: "masquerade", text: "No, no, no! Only one key left and you're still coming?" },
    { who: "masquerade", text: "The last one is my best hiding place ever. EVER. You'll never… okay, you might. But you won't!" },
    { who: "keeper", text: "This is it. One more key." },
  ],
];

const RELAY: StoryLine[][] = [
  [
    { who: "masquerade", text: "Surprise! The key WAS here… was. I moved it. Hehehe!" },
    { who: "masquerade", text: "I left you a little clue. Very generous of me, no?" },
    { who: "keeper", text: "A trick, not a dead end. Follow the clue." },
  ],
  [
    { who: "narrator", text: "Inside the chest: a torn scrap of map, and a few strands of raffia." },
    { who: "masquerade", text: "You opened the chest and… nothing! Well, nearly nothing. Read it well!" },
  ],
];

const FINISH: StoryLine[][] = [
  [
    { who: "masquerade", text: "Ah! You've beaten me. Every key. Every single one!" },
    { who: "masquerade", text: "I'll admit it… that was impressive. I'll be back, with even more tricks!" },
    { who: "narrator", text: "The Masquerade spins away in a whirl of colour, and the drums go quiet." },
    { who: "keeper", text: "Champion! The keys are yours." },
  ],
];

/** A steady pick from a list: the same hunt and beat always tell the same version. */
function pick<T>(list: T[], seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return list[Math.abs(h) % list.length];
}

/** The default lines for a beat (when the hunt has none of its own). `keys`: how many keys the hunt has. */
export function defaultBeat(beat: StoryBeat, huntId: string, keys: number): StoryLine[] {
  const seed = `${huntId}:${beat}`;
  if (beat === "start") return pick(START, seed);
  if (beat === "finish") return pick(FINISH, seed);
  if (beat.startsWith("relay:")) return pick(RELAY, seed);
  const n = Number(beat.slice(4));
  return n === keys - 1 ? pick(LAST_KEY, seed) : pick(KEY, seed);
}

/** Now and then the Masquerade has his say about the race's news (light and playful; null: he keeps quiet). */
export function taunt(kind: string, who: string): string | null {
  if (Math.random() > 0.5) return null;
  const lines: Record<string, string[]> = {
    first: [
      `🎭 The Masquerade: "${who} again? Hmph. Beginner's luck, every time."`,
      `🎭 The Masquerade: "Ehen! ${who} found my key first. I'll hide the next one under my own mask!"`,
      `🎭 The Masquerade: "Did somebody tell ${who}? It was the pepper seller, wasn't it?"`,
    ],
    finished: [
      `🎭 The Masquerade: "${who} has ALL my keys?! I need to sit down."`,
      `🎭 The Masquerade: "Fine, ${who}, you win this one. Just this one!"`,
    ],
    key: [
      `🎭 The Masquerade: "Run, run! ${who} is getting away with my keys!"`,
      `🎭 The Masquerade: "Hehe, ${who} thinks that was hard? Wait till the next one."`,
    ],
  };
  const list = lines[kind];
  return list ? list[Math.floor(Math.random() * list.length)] : null;
}
