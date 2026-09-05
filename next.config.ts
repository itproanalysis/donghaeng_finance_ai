import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Isolated browser QA can run without sharing the active server's build lock.
  distDir: process.env.DONGHAENG_NEXT_DIST_DIR || ".next",
};

export default nextConfig;
