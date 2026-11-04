import Link from "next/link";
import { FREE_CVS, PLAN_CVS } from "@jobtailor/core";
import { redirect } from "next/navigation";
import { CvSheet } from "@/components/CvSheet";
import { LandingStory } from "@/components/LandingStory";
import { LandingSignIn } from "@/components/LoginForm";
import { landingExample } from "@/lib/landing-examples";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (data.user) redirect("/dashboard");

  const jobs = landingExample();
  return (
    <main className="lp">
      <section className="hero">
        <div className="nav">
          <span className="logo">JobTailor</span>
          <Link href="/login">Sign in</Link>
        </div>
        <h1 className="disp">
          <span className="ln">
            <span>One you.</span>
          </span>
          <span className="ln">
            <span>A new CV</span>
          </span>
          <span className="ln">
            <span>for every job.</span>
          </span>
        </h1>
        <div className="join">
          <p>Every morning we read new postings and keep the ones that fit. Choose the jobs you want, and we'll write a CV for each from your own experience.</p>
          <LandingSignIn />
        </div>
        <div className="fan" aria-hidden="true">
          {[...jobs].reverse().map((j) => (
            <CvSheet key={j.title} resume={j.resume} style="fitted" />
          ))}
        </div>
      </section>

      <LandingStory jobs={jobs} />

      <section className="truth">
        <h2 className="disp">Nothing on it that you didn't tell us.</h2>
        <p className="ex">Every CV is checked against your own library of experience. If a draft adds anything that isn't yours, it gets rewritten. If it still doesn't pass, it isn't delivered, and we tell you.</p>
        <ol className="steps">
          <li>
            <b>1</b>
            <strong>Tell us what you've done</strong>
            <span>Upload your CV and check the facts we pull from it.</span>
          </li>
          <li>
            <b>2</b>
            <strong>Say what you're looking for</strong>
            <span>Any occupation, work style or location.</span>
          </li>
          <li>
            <b>3</b>
            <strong>Open your matches each morning</strong>
            <span>By email and on your dashboard. Click any job to get its CV.</span>
          </li>
        </ol>
      </section>

      <section className="end">
        <h2 className="disp">Start with what you've already done.</h2>
        <div className="join">
          <LandingSignIn />
        </div>
        <div className="plans">
          <div>
            <b>Free</b>Daily matches, plus {FREE_CVS} CVs to try it.
          </div>
          <div>
            <b>Paid</b>{PLAN_CVS} CVs, by the month or for 30 days, for your matches or any job you paste in. Add more whenever you need them.
          </div>
        </div>
        <div className="foot">
          <Link href="/privacy">Privacy</Link>
          <Link href="/pricing">Plans</Link>
          <Link href="/login">Sign in</Link>
          <Link href="/waitlist">Join the waitlist</Link>
        </div>
      </section>
    </main>
  );
}
