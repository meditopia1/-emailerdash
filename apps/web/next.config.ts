import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@marketing-os/shared", "@marketing-os/email"],
  devIndicators: false,
  // Keep production builds from replacing assets used by a running dev server.
  distDir: process.env.NODE_ENV === "development" ? process.env.MARKETING_OS_E2E === "1" ? ".next-test" : ".next-dev" : ".next",
  typescript: { tsconfigPath: process.env.MARKETING_OS_E2E === "1" ? "tsconfig.e2e.json" : "tsconfig.json" },
};
export default nextConfig;
