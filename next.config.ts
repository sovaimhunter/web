import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Pi Agent SDK is a Node-only package (uses node:fs / node:os / node:path
  // and ESM internals). Keep it external so Next.js does not try to bundle it
  // into the serverless/edge bundle, where those built-ins do not exist.
  serverExternalPackages: ["@earendil-works/pi-coding-agent"],

  // The validation catalog is loaded with fs at runtime. Its path is dynamic
  // from the bundler's point of view, so explicitly include it in every
  // server trace (including Vercel functions).
  outputFileTracingIncludes: {
    "/*": ["./.agents/skills/document-consistency/SKILL.md"],
  },
};

export default nextConfig;
