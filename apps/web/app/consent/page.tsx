import Link from "next/link";
import { redirect } from "next/navigation";
import { giveConsent, signOut } from "@/app/actions";
import { requireUser } from "@/lib/auth";

export default async function ConsentPage() {
  const { profile } = await requireUser();
  if (profile.consented_at) redirect("/onboarding");
  return (
    <div className="public">
      <div className="public-top">
        <Link className="logo" href="/">
          CV Tailor
        </Link>
      </div>
    <main className="page narrow">
      <div className="stack">
        <h1>Before you start</h1>
        <p>To find roles and write your CVs, CV Tailor stores the work history and preferences you give it, and sends your facts and each job posting to an AI model to write the CV. That model may be run by Anthropic, or by DeepSeek, which says it stores data in China.</p>
        <p>
          You can export or delete everything at any time from your settings. The <Link href="/privacy">privacy page</Link> explains who handles your data and your rights.
        </p>
        <div className="row">
          <form action={giveConsent}>
            <button className="primary" type="submit">
              I agree, continue
            </button>
          </form>
          <form action={signOut}>
            <button type="submit">No thanks, sign out</button>
          </form>
        </div>
      </div>
    </main>
    </div>
  );
}
