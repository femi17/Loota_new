import type { Metadata } from "next";
import { CONTACT_EMAIL, LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = { title: "Privacy · Loota", description: "What Loota collects about you, why, who we share it with, and your rights." };

export default function PrivacyPage() {
  return (
    <LegalPage
      path="/privacy"
      title="Privacy policy"
      updated="23 November 2026"
      intro={
        <p>
          This page explains what Loota collects about you, why, who we share it with and what you can ask us to do. We follow the Nigeria Data Protection Act 2023.
        </p>
      }
    >
      <section>
        <h2>1. What we collect</h2>
        <ul>
          <li><b>Your account:</b> your email address, your hunter name and your password. The password is stored only in a scrambled form we can&apos;t read.</li>
          <li><b>Your hunter:</b> your avatar&apos;s look, coins, vehicles, items, clan, keys and results.</li>
          <li><b>Your home spot:</b> a public place you pick when you start, such as a park or landmark, never your address. If you tap &quot;use my location&quot;, your phone shares its rough location once to find a public spot near you. We don&apos;t track where you go in real life.</li>
          <li><b>Your play:</b> where your hunter goes on the in-game map, your answers, and your chat messages.</li>
          <li><b>Your device:</b> a session ID, so the game runs on one device at a time, and the basic details every website receives (IP address, browser and device type) in our hosts&apos; logs.</li>
          <li><b>Payments:</b> if you buy coins, Paystack handles your card or bank details; we only keep the amount, the date, the status and Paystack&apos;s reference.</li>
          <li><b>Prize claims:</b> if you win, the name, bank details and ID you send us to claim your prize.</li>
        </ul>
      </section>

      <section>
        <h2>2. Why we use it</h2>
        <ul>
          <li>To run the game and your account (our agreement with you).</li>
          <li>To run fair hunts and pay prizes: checking one account per person, stopping cheating, and confirming winners (our legitimate interest, and our agreement with you).</li>
          <li>To email you about your account and your hunts, such as sign-in links and prize codes.</li>
          <li>To keep payment and prize records the law requires us to keep.</li>
        </ul>
        <p>We don&apos;t sell your data. We don&apos;t currently use advertising trackers on Loota. If we add one (for example to measure our Facebook ads), we&apos;ll update this page first.</p>
      </section>

      <section>
        <h2>3. What other people see</h2>
        <p>Other players and viewers of our live broadcast can see your hunter name, avatar, your hunter&apos;s moves on the map during hunts, your place on leaderboards, and your chat messages. They never see your email address.</p>
      </section>

      <section>
        <h2>4. Who we share it with</h2>
        <p>Only with the companies that help us run Loota, for that purpose only:</p>
        <ul>
          <li><b>Supabase</b>: our database and sign-in.</li>
          <li><b>Vercel</b>: hosts the website.</li>
          <li><b>Paystack</b>: takes payments for coins.</li>
          <li><b>Resend</b>: sends our emails.</li>
          <li><b>Map services</b> based on OpenStreetMap: load the map pictures and search for places, so they see your IP address.</li>
        </ul>
        <p>Some of these companies store data outside Nigeria. When they do, we rely on their contracts and safeguards to protect it. We&apos;ll also share data if the law requires it.</p>
      </section>

      <section>
        <h2>5. How long we keep it</h2>
        <ul>
          <li>Your account data, for as long as your account is open.</li>
          <li>Payment and prize records, for 6 years, as tax and accounting law requires.</li>
          <li>Server logs, for a few weeks.</li>
        </ul>
      </section>

      <section>
        <h2>6. Your rights</h2>
        <p>
          You can ask us for a copy of your data, to correct it, to delete it and your account, or to stop using it for a purpose you object to. Email{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-gold">{CONTACT_EMAIL}</a> from your account&apos;s email address, and we&apos;ll reply within 30 days. If you&apos;re
          unhappy with our answer, you can complain to the Nigeria Data Protection Commission (ndpc.gov.ng).
        </p>
      </section>

      <section>
        <h2>7. Children</h2>
        <p>Loota isn&apos;t for children under 13. If we learn that a child under 13 has an account, we&apos;ll delete it.</p>
      </section>

      <section>
        <h2>8. Changes</h2>
        <p>If we change this policy in a way that matters, we&apos;ll tell you in the game before the change applies.</p>
      </section>
    </LegalPage>
  );
}
