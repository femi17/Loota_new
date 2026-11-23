import type { Metadata } from "next";
import Link from "next/link";
import { CONTACT_EMAIL, LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = { title: "Terms · Loota", description: "The terms for using Loota, the real-map treasure hunt game." };

export default function TermsPage() {
  return (
    <LegalPage
      path="/terms"
      title="Terms of use"
      updated="23 November 2026"
      intro={
        <p>
          These terms apply when you use Loota (playloota.com) or create a hunter. Creating a hunter means you agree to them, to the{" "}
          <Link href="/rules" className="text-gold">Hunt rules</Link> and to how we handle your data in our <Link href="/privacy" className="text-gold">Privacy policy</Link>.
        </p>
      }
    >
      <section>
        <h2>1. Your account</h2>
        <ul>
          <li>You must be 13 or over to create a hunter, and 18 or over to buy coins or claim a prize.</li>
          <li>Give a real email address that you use: we send prize codes and important messages there.</li>
          <li>Keep your password to yourself. You&apos;re responsible for what happens on your account.</li>
          <li>Pick a hunter name that isn&apos;t offensive and doesn&apos;t pretend to be someone else. We may change or remove a name that breaks this rule.</li>
        </ul>
      </section>

      <section>
        <h2>2. Playing fairly</h2>
        <p>
          You agree to play by the <Link href="/rules" className="text-gold">Hunt rules</Link>: one account per person, no bots or modified apps, no deliberately using bugs, and
          no harassing other players. Be decent in chat. We may remove messages and suspend or close accounts that break these terms.
        </p>
      </section>

      <section>
        <h2>3. Coins</h2>
        <ul>
          <li>Coins are the game&apos;s money. You can earn them by playing, or buy them through our payment provider, Paystack.</li>
          <li>Coins have no cash value. They can&apos;t be sold, swapped for money or moved to another account.</li>
          <li>Bought coins aren&apos;t refundable, except where the law says otherwise or a payment went wrong. If you were charged and didn&apos;t get your coins, email us with your payment reference.</li>
          <li>We may change coin prices and what things cost in the game. That never affects coins you already have.</li>
        </ul>
      </section>

      <section>
        <h2>4. The game and the live show</h2>
        <ul>
          <li>The map, places and travel in Loota are a game. Places are based on real maps, which can be out of date. Never go to a hunt&apos;s places in person to play.</li>
          <li>During hunts your hunter name, avatar and moves can appear on our live broadcast, in recordings and on leaderboards.</li>
          <li>We keep improving Loota, so features may change, and the game may sometimes be unavailable.</li>
        </ul>
      </section>

      <section>
        <h2>5. What belongs to whom</h2>
        <p>
          Loota&apos;s game, stories, artwork and name belong to us. You may share screenshots and clips of your play. Maps are based on OpenStreetMap data, © OpenStreetMap
          contributors.
        </p>
      </section>

      <section>
        <h2>6. Our responsibility</h2>
        <p>
          We provide Loota as it is. As far as the law allows, we aren&apos;t responsible for losses caused by the game being unavailable, by mistakes in map data, or by
          things outside our control, and our total responsibility to you is limited to what you paid us in the 12 months before the problem. Nothing here limits rights you
          have under Nigerian consumer law.
        </p>
      </section>

      <section>
        <h2>7. Closing your account</h2>
        <p>
          You can ask us to close your account at any time by emailing <a href={`mailto:${CONTACT_EMAIL}`} className="text-gold">{CONTACT_EMAIL}</a> from your account&apos;s
          address. Any coins left on it are lost when it closes. We may close accounts that break these terms.
        </p>
      </section>

      <section>
        <h2>8. Changes and law</h2>
        <p>
          We may update these terms. If a change matters, we&apos;ll tell you in the game before it applies. These terms are governed by the laws of the Federal Republic of
          Nigeria, and disputes go to the courts of Lagos State.
        </p>
      </section>
    </LegalPage>
  );
}
