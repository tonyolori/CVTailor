import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { loggedFetch } from "../log";

/** Acts as the signed-in user, so row-level security applies to every query. */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { fetch: loggedFetch },
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(toSet) {
        try {
          toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a server component, which can't set cookies. The proxy refreshes the session.
        }
      },
    },
  });
}
