import { NextResponse, type NextRequest } from "next/server";
import { siteUrl } from "@/lib/site";
import { adminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Deletes everything: storage objects first, then the auth user, which cascades through
 * every table. Payment rows keep an amount and reference with the user link removed, as
 * the schema's on-delete rule sets, for financial records.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.redirect(siteUrl("/login", request), 303);

  const form = await request.formData();
  if (String(form.get("confirm")).trim().toLowerCase() !== "delete") {
    return NextResponse.redirect(siteUrl("/settings?error=confirm", request), 303);
  }

  const admin = adminClient();
  const id = auth.user.id;

  const { data: documents } = await admin.from("documents").select("storage_path").eq("user_id", id);
  const paths = new Set((documents ?? []).map((d) => d.storage_path));
  const { data: folders } = await admin.storage.from("documents").list(id, { limit: 1000 });
  for (const folder of folders ?? []) {
    if (folder.id) {
      paths.add(`${id}/${folder.name}`);
      continue;
    }
    const { data: inner } = await admin.storage.from("documents").list(`${id}/${folder.name}`, { limit: 1000 });
    for (const f of inner ?? []) paths.add(`${id}/${folder.name}/${f.name}`);
  }
  if (paths.size > 0) {
    const { error } = await admin.storage.from("documents").remove([...paths]);
    if (error) return NextResponse.redirect(siteUrl("/settings?error=delete", request), 303);
  }

  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) return NextResponse.redirect(siteUrl("/settings?error=delete", request), 303);
  if (auth.user.email) await admin.from("allowed_emails").delete().eq("email", auth.user.email.toLowerCase());

  await supabase.auth.signOut().catch(() => undefined);
  return NextResponse.redirect(siteUrl("/login", request), 303);
}
