import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // The build this is (Vercel's commit): an open broadcast reloads itself when a newer one is live (/api/version)
  env: { NEXT_PUBLIC_BUILD_ID: process.env.VERCEL_GIT_COMMIT_SHA ?? "dev" },
  cacheComponents: true,
  partialPrefetching: true,
  // Browsers still ask for /favicon.ico on their own: the app's icon (src/app/icon.png) answers.
  async rewrites() {
    return [{ source: "/favicon.ico", destination: "/icon.png" }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
