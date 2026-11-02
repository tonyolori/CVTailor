import Link from "next/link";
import { signOut } from "@/app/actions";
import { isAdmin } from "@/lib/auth";

export async function Nav({ email }: { email: string }) {
  const admin = await isAdmin(email);
  return (
    <nav className="nav">
      <Link className="brand" href="/dashboard">
        JobTailor
      </Link>
      <Link href="/dashboard">Matches</Link>
      <Link href="/library">Library</Link>
      <Link href="/preferences">Preferences</Link>
      <Link href="/settings">Settings</Link>
      {admin ? <Link href="/admin">Admin</Link> : null}
      <form action={signOut}>
        <button className="link" type="submit">
          Sign out
        </button>
      </form>
    </nav>
  );
}
