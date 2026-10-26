import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
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
