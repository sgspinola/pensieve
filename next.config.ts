import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Ticket 29: emit .next/standalone (a minimal server.js plus only the
  // traced node_modules it needs) for the production container image.
  output: "standalone",
  // No `next/image` anywhere, so no optimizer — and no `sharp` (an optional
  // dependency of `next` that the server trace would otherwise pull into the
  // image along with its native libvips). The "next-server" key targets
  // that server trace (see Next's build/collect-build-traces.js).
  images: { unoptimized: true },
  outputFileTracingExcludes: {
    "next-server": ["**/node_modules/sharp/**/*", "**/node_modules/@img/**/*"],
  },
};

export default nextConfig;
