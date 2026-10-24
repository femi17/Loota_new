/**
 * Fresh questions written by Claude (owner, 21 Oct 2026: "so we do not keep repeating questions, riddles, that quiz").
 *
 * Two banks grow:
 *   - the Key Trial / street seller bank (trial_questions, "general" and "nigeria"): new rows marked source 'claude';
 *   - each landmark's check-in questions (scripts/data/landmarks.json, then the landmarks table).
 *
 * Claude Haiku 5.5 writes them (cheap: owner, 22 Oct 2026); Claude Sonnet 5.5 checks every one in a separate pass that
 * answers it without seeing the answer (the options shuffled) and flags anything ambiguous, time-sensitive or doubtful.
 * Only questions it answers the same way, sure and unflagged, are kept; repeats of existing questions are dropped.
 *
 *   node scripts/generate-questions.mts                 # 60 per bank category; each landmark up to 5
 *   node scripts/generate-questions.mts --bank 100 --landmarks 0
 *   node scripts/generate-questions.mts --bank 30 --landmarks 0 --category nigeria
 *   node scripts/generate-questions.mts --dry           # write nothing, print what would be added
 *
 * Reads ANTHROPIC_API_KEY, NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY from .env.local.
 */
import { readFileSync, writeFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

process.loadEnvFile(".env.local");
const arg = (name: string, fallback: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : fallback;
};
const BANK_PER_CATEGORY = arg("bank", 60);
/** How the bank's new questions split across levels 1, 2 and 3 (percent), e.g. --split 0,40,60. */
const SPLIT = (process.argv.includes("--split") ? process.argv[process.argv.indexOf("--split") + 1] : "50,30,20").split(",").map(Number);
const LANDMARK_TOTAL = arg("landmarks", 5); // each landmark topped up to this many questions
const DRY = process.argv.includes("--dry");
const ONLY = process.argv.includes("--category") ? process.argv[process.argv.indexOf("--category") + 1] : null;
// Haiku by default (cheap: owner, 22 Oct); --writer sonnet for the hardest batches (Haiku's "hard" is often easy).
const WRITER: "claude-haiku-5-5" | "claude-sonnet-5-5" = process.argv.includes("--writer") && process.argv[process.argv.indexOf("--writer") + 1] === "sonnet" ? "claude-sonnet-5-5" : "claude-haiku-5-5";
const CHECKER = "claude-sonnet-5-5";
/** $ per million tokens, in and out. */
const PRICE: Record<string, [number, number]> = { "claude-haiku-5-5": [0.1, 0.5], "claude-sonnet-5-5": [2, 10] };
const BATCH = 20;
const LANDMARKS_FILE = "scripts/data/landmarks.json";

const claude = new Anthropic();
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });

type Question = { prompt: string; options: string[]; answer: number; difficulty: number };

const Written = z.object({
  questions: z.array(
    z.object({
      prompt: z.string(),
      options: z.array(z.string()),
      answer: z.number().int(),
      difficulty: z.number().int(),
    }),
  ),
});
const Checked = z.object({
  answers: z.array(
    z.object({
      n: z.number().int(),
      choice: z.number().int(),
      sure: z.boolean(),
      problem: z.string().nullable(),
    }),
  ),
});

// What a run costs, from the usage Claude reports.
const spent = { input: 0, output: 0, dollars: 0 };
const dollars = () => spent.dollars;

async function ask<T>(model: typeof WRITER | typeof CHECKER, system: string, user: string, schema: z.ZodType<T>, effort: "medium" | "high"): Promise<T | null> {
  const response = await claude.beta.messages.parse({
    model,
    max_tokens: 16000,
    // Claude Sonnet 5.5: a declined request is retried on Anthropic's recommended model (Claude Haiku 5.5 has none).
    ...(model === CHECKER ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    output_config: { effort, format: betaZodOutputFormat(schema) },
    system,
    messages: [{ role: "user", content: user }],
  });
  spent.input += response.usage.input_tokens;
  spent.output += response.usage.output_tokens;
  spent.dollars += (response.usage.input_tokens * PRICE[model][0] + response.usage.output_tokens * PRICE[model][1]) / 1e6;
  if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") {
    console.log(`  (skipped: ${response.stop_reason})`);
    return null;
  }
  return response.parsed_output ?? null;
}

const RULES = `Rules for every question:
- Exactly one option is correct, and it stays correct: no "current" office holders, records, prices, populations or anything that changes.
- 4 options. The wrong ones are plausible and the same kind and length as the right one. No "all of the above".
- Short: the question at most 110 characters, each option at most 28. Players have 15 seconds on a phone.
- Plain, friendly English. Nothing about politics, religion, ethnic groups' traits, violence or tragedies.
- The question doesn't give its answer away: the answer's words aren't in the question.
- Each question is about a different thing, not the same fact asked another way.
- Facts you are certain of. If you're not sure, write a different question.`;

// Harder than the first bank (owner, 24 Oct 2026: "the questions are too way easy").
const DIFFICULTY = `Difficulty: 1 = a keen quiz player gets it, never schoolbook-easy; 2 = a pub-quiz champion gets it; 3 = an expert's question, obscure but fair, the kind one player in ten gets. Never the famous facts everyone knows (the capital, jollof rice, Fela, Burna Boy, the Super Eagles' nickname and the like).`;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function wellFormed(q: Question) {
  return (
    q.options.length === 4 &&
    q.answer >= 0 &&
    q.answer < 4 &&
    new Set(q.options.map(norm)).size === 4 &&
    q.prompt.length <= 140 &&
    q.options.every((o) => o.length > 0 && o.length <= 36) &&
    !` ${norm(q.prompt)} `.includes(` ${norm(q.options[q.answer])} `) // gives its answer away
  );
}

/**
 * The second pass: answer each question cold (options shuffled), sure or not, and name any problem, including asking
 * the same thing as a question players already have (`asked`).
 */
async function check(questions: Question[], context: string, asked: string[]): Promise<Question[]> {
  const shuffled = questions.map((q) => {
    const order = [0, 1, 2, 3].sort(() => Math.random() - 0.5);
    return { order, options: order.map((i) => q.options[i]) };
  });
  const listing = questions
    .map((q, n) => `${n}. ${q.prompt}\n${shuffled[n].options.map((o, i) => `   ${i}) ${o}`).join("\n")}`)
    .join("\n\n");
  const result = await ask(
    CHECKER,
    `You check quiz questions for a game played in Nigeria before players see them. ${context}`,
    `Answer each question below. For each, give the number of the option you believe is correct, whether you are sure,
and a problem if there is one: more than one option could be right, none is right, the answer changes over time, the
fact is disputed or you can't verify it, the question gives its answer away, it asks the same fact as one of the
existing questions below (or as another question in this list), or it is unclear or inappropriate. Otherwise problem
is null.

${listing}

Existing questions:
${asked.slice(-300).map((a) => `- ${a}`).join("\n") || "(none)"}`,
    Checked,
    "high",
  );
  if (!result) return [];
  const kept: Question[] = [];
  for (const a of result.answers) {
    const q = questions[a.n];
    if (!q) continue;
    const agreed = shuffled[a.n].order[a.choice] === q.answer;
    if (agreed && a.sure && !a.problem) kept.push(q);
    else console.log(`  dropped: "${q.prompt}"${a.problem ? ` (${a.problem})` : agreed ? " (not sure)" : " (answered differently)"}`);
  }
  return kept;
}

// ---- The Key Trial / street seller bank
const CATEGORIES = {
  general: `General knowledge for anyone: science, nature, the human body, world geography, space, sport, words and
numbers. About a third should be riddles or brain teasers with one clear answer (a street seller asks these): fresh
ones that make people think, not the well-worn riddles everyone has heard.`,
  nigeria: `Nigeria: its states and cities, rivers and landmarks, food, music, films, sport, languages, festivals and
settled history.`,
} as const;

async function growBank() {
  for (const [category, about] of Object.entries(CATEGORIES)) {
    if (ONLY && category !== ONLY) continue;
    const { data: existing } = await db.from("trial_questions").select("prompt").eq("category", category);
    const seen = new Set((existing ?? []).map((r) => norm(r.prompt)));
    const asked = (existing ?? []).map((r) => r.prompt); // grows as this run adds questions
    // Level 1 is asked most (street sellers, early keys), so most new questions are level 1.
    const want = [
      { difficulty: 1, count: Math.round((BANK_PER_CATEGORY * SPLIT[0]) / 100) },
      { difficulty: 2, count: Math.round((BANK_PER_CATEGORY * SPLIT[1]) / 100) },
      { difficulty: 3, count: BANK_PER_CATEGORY - Math.round((BANK_PER_CATEGORY * SPLIT[0]) / 100) - Math.round((BANK_PER_CATEGORY * SPLIT[1]) / 100) },
    ];
    for (const { difficulty, count } of want) {
      let added = 0;
      for (let round = 0; added < count && round < Math.ceil(count / BATCH) + 2; round++) {
        const n = Math.min(BATCH, count - added);
        console.log(`${category} · level ${difficulty}: writing ${n}…`);
        const written = await ask(
          WRITER,
          `You write multiple-choice questions for Loota, a real-map treasure-hunt game played in Nigeria.`,
          `Write ${n} new ${category} questions, all difficulty ${difficulty}.
${about}
${DIFFICULTY}
${RULES}
Don't repeat or closely rephrase any of these existing questions:
${asked.slice(-300).map((a) => `- ${a}`).join("\n") || "(none yet)"}`,
          Written,
          "medium",
        );
        if (!written) continue;
        const fresh = written.questions
          .map((q) => ({ ...q, difficulty }))
          .filter((q) => wellFormed(q) && !seen.has(norm(q.prompt)));
        const kept = (await check(fresh, `These are ${category} questions.`, asked)).slice(0, count - added);
        for (const q of kept) {
          seen.add(norm(q.prompt));
          asked.push(q.prompt);
        }
        if (kept.length && !DRY) {
          const { error } = await db.from("trial_questions").insert(
            kept.map((q) => ({ category, difficulty, prompt: q.prompt, choices: q.options, answer: q.answer, source: "claude" })),
          );
          if (error) throw error;
        }
        if (DRY) for (const q of kept) console.log(`  + ${q.prompt}  [${q.options[q.answer]}]`);
        added += kept.length;
        console.log(`  kept ${kept.length} of ${written.questions.length} · ${category} level ${difficulty}: ${added}/${count} · $${dollars().toFixed(2)} so far`);
      }
    }
  }
}

// ---- The landmarks' check-in questions
type Landmark = { name: string; city: string; fact: string; questions: { q: string; options: string[]; answer: number }[] };

/** Each landmark topped up to LANDMARK_TOTAL questions (a few tries each), so a rerun carries on where one stopped. */
async function growLandmarks() {
  const list = JSON.parse(readFileSync(LANDMARKS_FILE, "utf8")) as Landmark[];
  let total = 0;
  for (const l of list) {
    const before = l.questions.length;
    for (let round = 0; l.questions.length < LANDMARK_TOTAL && round < 3; round++) {
      const need = LANDMARK_TOTAL - l.questions.length;
      const seen = new Set(l.questions.map((q) => norm(q.q)));
      const written = await ask(
        WRITER,
        `You write multiple-choice questions for Loota, a real-map treasure-hunt game played in Nigeria. A player who has
travelled to a landmark checks in by answering a question about it; they can see its name and city.`,
        `Write ${need + 2} new questions about ${l.name} in ${l.city}: its history, what it is, what it looks like,
what happens there, or its story. The player already sees the name and city, so don't ask where it is. A fact we
already show players: "${l.fact}"
${RULES}
Set difficulty to 1 or 2. Don't repeat these questions it already has:
${l.questions.map((q) => `- ${q.q}`).join("\n")}`,
        Written,
        "medium",
      );
      if (!written) continue;
      const fresh = written.questions.filter((q) => wellFormed(q) && !seen.has(norm(q.prompt)));
      const context = `These questions are about ${l.name} in ${l.city}; the player is there and sees its name and city.`;
      const kept = (await check(fresh, context, l.questions.map((q) => q.q))).slice(0, need);
      // Added at the end: the check-ins already asked keep their question numbers.
      l.questions.push(...kept.map((q) => ({ q: q.prompt, options: q.options, answer: q.answer })));
      if (DRY) for (const q of kept) console.log(`  + ${q.prompt}  [${q.options[q.answer]}]`);
      else if (kept.length) writeFileSync(LANDMARKS_FILE, JSON.stringify(list, null, 2) + "\n");
    }
    total += l.questions.length - before;
    console.log(`${l.name}: +${l.questions.length - before} (now ${l.questions.length}) · $${dollars().toFixed(2)} so far`);
  }
  console.log(`Landmarks: ${total} new questions.`);
  if (!DRY) await syncLandmarks(list);
}

/** The landmarks table's questions, as in landmarks.json (retrying when the connection drops). */
async function syncLandmarks(list: Landmark[]) {
  for (const l of list) {
    for (let attempt = 1; ; attempt++) {
      const { error } = await db.from("landmarks").update({ questions: l.questions }).eq("name", l.name);
      if (!error) break;
      if (attempt === 4) throw error;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  console.log(`Landmarks in the database match ${LANDMARKS_FILE}.`);
}

if (BANK_PER_CATEGORY > 0) await growBank();
if (LANDMARK_TOTAL > 0) await growLandmarks();
console.log(`${DRY ? "Dry run, nothing written. " : ""}Tokens: ${spent.input} in, ${spent.output} out · about $${dollars().toFixed(2)}`);
