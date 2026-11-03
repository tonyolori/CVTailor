import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

const repoRoot = path.resolve(process.cwd(), "../..");

// One .env at the repo root in development. Hosts set real env vars instead. Force a reload,
// because Next has already loaded (and cached) env files from this app's own folder.
loadEnvConfig(repoRoot, process.env.NODE_ENV !== "production", console, true);

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

const config: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  outputFileTracingRoot: repoRoot,
  transpilePackages: ["@jobtailor/core", "@jobtailor/llm", "@jobtailor/render"],
  serverExternalPackages: ["@react-pdf/renderer", "unpdf", "mammoth"],
  outputFileTracingIncludes: {
    "/api/**": ["../../node_modules/@expo-google-fonts/inter/**/*.ttf", "../../node_modules/@expo-google-fonts/lora/**/*.ttf"],
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default config;
