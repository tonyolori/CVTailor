// Runs the Claude Code binary's own login, which completes in Anthropic's browser flow.
// JobTailor never sees or stores the credentials.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pkg = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`;
const ext = process.platform === "win32" ? ".exe" : "";
const bin = require.resolve(`${pkg}/claude${ext}`);
const { ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, ...env } = process.env;
const args = process.argv.slice(2);
process.exit(spawnSync(bin, args.length ? args : ["auth", "login"], { stdio: "inherit", env }).status ?? 1);
