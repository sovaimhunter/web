import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Pi Agent SDK is a Node-only package (uses node:fs / node:os / node:path
  // and ESM internals). Keep it external so Next.js does not try to bundle it
  // into the serverless/edge bundle, where those built-ins do not exist.
  serverExternalPackages: ["@earendil-works/pi-coding-agent"],
};

export default nextConfig;
