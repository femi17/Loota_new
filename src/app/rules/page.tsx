import type { Metadata } from "next";
import Link from "next/link";
import { CONTACT_EMAIL, LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = { title: "Hunt rules · Loota", description: "How Loota's prize hunts work, who wins, and how prizes are claimed and paid." };

export default function RulesPage() {
  return (
    <LegalPage
      path="/rules"
      title="Hunt rules"
      updated="23 November 2026"
      intro={
        <p>
          These rules apply to every Loota hunt that has a prize. Taking part in a hunt means you accept them, along with our{" "}
          <Link href="/terms" className="text-gold">Terms</Link>.
        </p>
      }
    >
      <section>
        <h2>1. Free to enter</h2>
        <ul>
          <li>Entering a hunt is free. You never have to pay to take part or to win.</li>
          <li>Coins can be earned in the game or bought, but keys, relics and places in a hunt can&apos;t be bought.</li>
          <li>Loota is a game of skill: you win by solving riddles and puzzles and by how well you travel the map. There is no betting and no draw.</li>
        </ul>
      </section>

      <section>
        <h2>2. Who can win</h2>
        <ul>
          <li>Anyone 13 or over can play. You must be 18 or over to claim a prize.</li>
          <li>One account per person. Prizes go to the real person who owns the winning account, and to nobody else.</li>
          <li>People who run Loota, and their close families, can play but can&apos;t win prizes.</li>
        </ul>
      </section>

      <section>
        <h2>3. How a hunt works</h2>
        <ul>
          <li>Each hunt&apos;s card shows its prize, how many winners there are, how many keys there are, where the keys are hidden (worldwide, a country or a state), and when it starts and ends. All times are Lagos time (WAT).</li>
          <li>Hunts run between 9 am and 9 pm. Each key is found by working out a riddle, travelling to the place on the in-game map, and beating the challenge there.</li>
          <li>You play on your phone or computer. You never need to go to a real place in person, and you shouldn&apos;t.</li>
        </ul>
      </section>

      <section>
        <h2>4. Who wins</h2>
        <ul>
          <li>The winners are the first hunters to collect every key before the hunt ends, in the order our server records them. If a hunt has 1 winner, the first to finish wins.</li>
          <li>The finishing order on our server is final. If two finishes are recorded at the same moment, the earlier one in our records wins.</li>
          <li>If a winner can&apos;t claim their prize (for example, they&apos;re under 18, can&apos;t prove who they are, or broke these rules), the prize passes to the next hunter to finish.</li>
        </ul>
      </section>

      <section>
        <h2>5. Fair play</h2>
        <p>You&apos;ll be disqualified, and can lose your account, if you:</p>
        <ul>
          <li>use more than one account, or play someone else&apos;s account;</li>
          <li>use bots, scripts, auto-clickers, modified apps or anything else that plays for you;</li>
          <li>deliberately use a bug to get ahead (tell us about it instead, at <a href={`mailto:${CONTACT_EMAIL}`} className="text-gold">{CONTACT_EMAIL}</a>);</li>
          <li>harass other players or try to interfere with the game or its servers.</li>
        </ul>
        <p>Talking about riddles with friends and playing in a clan are allowed.</p>
      </section>

      <section>
        <h2>6. Claiming a prize</h2>
        <ul>
          <li>When you collect every key, we email the address on your account. A winner&apos;s email holds a one-time prize code.</li>
          <li>To claim, reply to that email within 7 days with your code, your full name, and a bank account in your own name. Keep the code private: anyone who has it could try to claim your prize.</li>
          <li>We check your code against our records and may ask for a photo ID showing the same name as the bank account.</li>
          <li>Cash prizes are paid by bank transfer in naira, normally within 3 working days of your claim being checked. Winners outside Nigeria are paid by a method we agree with them.</li>
          <li>Prizes can&apos;t be swapped or passed to someone else. Any tax on a prize is the winner&apos;s responsibility.</li>
          <li>Loota will never ask for your password, your card details or a fee to release a prize. Any message that does isn&apos;t from us.</li>
        </ul>
      </section>

      <section>
        <h2>7. Being on the show</h2>
        <ul>
          <li>Hunts can be shown live, and in recordings, with each hunter&apos;s hunter name, avatar and moves on the map.</li>
          <li>We announce winners by their hunter name. We&apos;ll ask before using your real name, photo or voice.</li>
        </ul>
      </section>

      <section>
        <h2>8. If something goes wrong</h2>
        <ul>
          <li>If a fault, an attack or anything else outside our control affects a hunt, we may pause it, extend it, run it again or cancel it. If we cancel a hunt, nobody wins its prize, and we&apos;ll say so on the game and on our pages.</li>
          <li>We may update these rules for future hunts. A hunt already running keeps the rules it started with.</li>
        </ul>
      </section>
    </LegalPage>
  );
}
