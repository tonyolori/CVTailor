import Link from "next/link";
import { WaitlistForm } from "@/components/WaitlistForm";

export const metadata = { title: "Join the waitlist - JobTailor" };

export default function WaitlistPage() {
  return (
    <main className="wl">
      <div className="nav">
        <Link className="logo" href="/">
          JobTailor
        </Link>
        <Link href="/login">Sign in</Link>
      </div>
      <div className="wlg">
        <div>
          <h1 className="disp">Join the waitlist.</h1>
          <p className="ex">JobTailor is invite only for now. Tell us who you are, and we'll email you when there's a place for you.</p>
        </div>
        <WaitlistForm />
      </div>
    </main>
  );
}
