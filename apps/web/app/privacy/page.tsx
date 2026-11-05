import Link from "next/link";

// TODO(Tony): have this policy reviewed against the Nigeria Data Protection Act 2023 before inviting
// anyone who isn't you. It's a plain draft, not legal advice. See docs/SETUP.md.
export default function PrivacyPage() {
  return (
    <div className="public">
      <div className="public-top">
        <Link className="logo" href="/">
          CV Tailor
        </Link>
      </div>
    <main className="page">
      <div className="stack">
        <h1>Privacy</h1>
        <div className="notice warn">Draft policy, pending legal review.</div>

        <h2>Who runs this</h2>
        <p>CV Tailor is an invite-only service run by Anthony Olori in Lagos, Nigeria. Contact the person who invited you with any question or request about your data.</p>

        <h2>What we hold</h2>
        <p>Your email address, the work history and other facts you give us, your job-search preferences, the CVs and cover letters written for you, which roles you've applied to, and payment records if you subscribe. An uploaded CV is read once to propose your library. The file isn't kept, and its text is erased after processing.</p>

        <p>If you join the waitlist, we hold your email address, plus your name and the work you're looking for if you give them. We use these only to invite you. Ask us and we'll delete them. If you paste in a job posting, we keep its text with your account so we can write your CV. Only you can see it.</p>

        <h2>Why</h2>
        <p>To find job postings that suit you and write CVs for them from your own facts, which is the service you asked for. We rely on your consent, given when you first sign in, and you can withdraw it at any time by deleting your account.</p>

        <h2>Who else handles it</h2>
        <p>These providers process data for us, and some store it outside Nigeria:</p>
        <ul>
          <li>Anthropic or DeepSeek, whichever we're using at the time: read your uploaded CV, score roles and write your CVs. Your CV, your facts including your contact details, your preferences and the posting are sent to its AI models for this. DeepSeek says it stores data in China.</li>
          <li>Supabase: database, sign-in and file storage.</li>
          <li>Resend: delivers email.</li>
          <li>The web host that serves this site.</li>
          <li>Paystack: takes payments, if you subscribe. We never see your card details.</li>
        </ul>
        <p>We don't sell your data, and one user's data is never included in another user's AI request.</p>

        <h2>How long</h2>
        <p>Until you delete your account. Deletion removes your rows and files straight away. Backups roll off within 30 days. Payment records may be kept for as long as the law requires.</p>

        <h2>Your rights</h2>
        <p>Under the Nigeria Data Protection Act 2023 you can access, correct, move and delete your data, and object to or restrict its use. Your settings page has a full export and account deletion. You can also complain to the Nigeria Data Protection Commission.</p>

        <small>
          <Link href="/">Back</Link>
        </small>
      </div>
    </main>
    </div>
  );
}
