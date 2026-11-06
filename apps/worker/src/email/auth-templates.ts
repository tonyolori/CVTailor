import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { signInLinkEmail } from "@cvtailor/core/email";
import { log } from "../log";

/*
Writes Supabase's sign-in emails from the shared email design. Local Supabase reads them through
config.toml. The hosted project doesn't: paste them in by hand (docs/SETUP.md).
Supabase may send either one, depending on whether the address already has an account, so both are the same.
*/
export const AUTH_TEMPLATES = ["magic_link", "confirmation"] as const;

export function authTemplatePath(name: (typeof AUTH_TEMPLATES)[number]): string {
  return fileURLToPath(new URL(`../../../../supabase/templates/${name}.html`, import.meta.url));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { html } = signInLinkEmail();
  for (const name of AUTH_TEMPLATES) writeFileSync(authTemplatePath(name), `${html}\n`);
  log("email.auth_templates_written", { count: AUTH_TEMPLATES.length });
}
