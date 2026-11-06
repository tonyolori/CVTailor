import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { signInLinkEmail, signUpLinkEmail } from "@cvtailor/core/email";
import { log } from "../log";

/*
Writes Supabase's sign-in emails from the shared email design. Local Supabase reads them through
config.toml. The hosted project doesn't: paste them in by hand (docs/SETUP.md).
confirmation is the first email a new person gets; magic_link is every sign-in after that.
*/
export const AUTH_TEMPLATES = { magic_link: signInLinkEmail, confirmation: signUpLinkEmail } as const;
export type AuthTemplate = keyof typeof AUTH_TEMPLATES;

export function authTemplatePath(name: AuthTemplate): string {
  return fileURLToPath(new URL(`../../../../supabase/templates/${name}.html`, import.meta.url));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const [name, render] of Object.entries(AUTH_TEMPLATES)) writeFileSync(authTemplatePath(name as AuthTemplate), `${render().html}\n`);
  log("email.auth_templates_written", { count: Object.keys(AUTH_TEMPLATES).length });
}
