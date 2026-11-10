import type { NextConfig } from "next";

// Every page in the console is per-user and always fresh, so the Cache Components model
// (static shells + cached segments) is left off.
const nextConfig: NextConfig = {
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
