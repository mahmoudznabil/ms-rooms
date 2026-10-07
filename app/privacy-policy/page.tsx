import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — MS-ROOMS",
  description: "How MS-ROOMS collects, uses, and deletes your data.",
};

export default function PrivacyPolicyPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-10">
      <p className="text-xs font-bold uppercase tracking-widest text-white/40">Privacy Policy</p>
      <h1 className="mt-1 text-3xl font-black tracking-tight">Privacy Policy</h1>
      <p className="mt-1 text-xs text-white/35">Effective: September 10, 2026 • Service: MS-ROOMS (BestAudioRoom) web app</p>
      <div className="mt-6 space-y-6 text-sm leading-relaxed text-white/60">
        <section>
          <h2 className="text-base font-bold text-white">1. Who we are</h2>
          <p className="mt-1">MS-ROOMS (BestAudioRoom). Backend on Cloudflare Pages + D1 + R2. Auth via Firebase project ms-rooms-auth. Contact: mahmoudnabil03@gmail.com / marcamgadalfonse2004@gmail.com.</p>
        </section>
        <section>
          <h2 className="text-base font-bold text-white">2. What we collect</h2>
          <p className="mt-1">Account (Firebase UID, email/phone when you provide them, display name, avatar, username), app activity (rooms, seats, messages, moments, follows, gifts, XP, transactions, check-ins, calls), device/technical (IP, user-agent, crash logs), security (reCAPTCHA token, CSRF token, Firebase ID token, TURN session metadata), support reports you submit. We do not collect payment cards: coins are earned-only (check-in, gifts, spin); there is no web checkout.</p>
        </section>
        <section>
          <h2 className="text-base font-bold text-white">3. How we use it</h2>
          <p className="mt-1">Provide rooms/auth/social features, verify Firebase tokens and reCAPTCHA, enforce rate limits, prevent abuse, troubleshoot. AI features (chat, summaries, translation) run via Firebase AI (Gemini); moderation blocks content when the moderator is unreachable.</p>
        </section>
        <section>
          <h2 className="text-base font-bold text-white">4. Security</h2>
          <p className="mt-1">HTTPS, HttpOnly Secure SameSite cookies for user and admin sessions, Firebase RS256 verification, CSRF double-submit tokens, in-isolate rate limiting plus Cloudflare WAF rate limiting (dashboard). No method is 100% secure.</p>
        </section>
        <section>
          <h2 className="text-base font-bold text-white">5. Sharing</h2>
          <p className="mt-1">We do not sell personal information. Processors: Cloudflare (hosting, D1, TURN), Google Firebase (auth), Google reCAPTCHA. Other users see your public profile/rooms/moments only. Legal/safety disclosures when required.</p>
        </section>
        <section>
          <h2 className="text-base font-bold text-white">6. Retention &amp; deletion</h2>
          <p className="mt-1">Sessions expire (30 days user, 12h admin). Security/audit logs up to 12 months. Self-service deletion in Profile deletes your account data; financial audit rows are retained without PII where the law requires. Backups per Cloudflare D1 retention.</p>
        </section>
        <section>
          <h2 className="text-base font-bold text-white">7. Cookies</h2>
          <p className="mt-1">Essential: session (30d), admin_session (12h, staff only), csrf_token (24h). reCAPTCHA/Firebase set their own cookies. Analytics only runs after you accept in the cookie banner.</p>
        </section>
        <section>
          <h2 className="text-base font-bold text-white">8. Children</h2>
          <p className="mt-1">Not directed to under-13s (or 16 where applicable). Contact us for deletion if a child provided data. Report abuse via Support; we review reports and ban abusers.</p>
        </section>
        <section>
          <h2 className="text-base font-bold text-white">9. Your rights</h2>
          <p className="mt-1">Access, correct, delete, or export your data via Profile or email. EEA/UK complaint to your authority; California CCPA rights apply (we do not sell).</p>
        </section>
      </div>
    </div>
  );
}
