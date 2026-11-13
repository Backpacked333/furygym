import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  // The check-in scanner uses the camera; nothing uses the rest.
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=()" },
];
const privatePage = [{ key: "X-Robots-Tag", value: "noindex, nofollow" }];

// Every page in the console is per-user and always fresh, so the Cache Components model
// (static shells + cached segments) is left off.
const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/admin/:path*", headers: privatePage },
      { source: "/account/:path*", headers: privatePage },
      { source: "/api/:path*", headers: privatePage },
      // The display link is its own credential: it must not leak in a Referer header.
      { source: "/display/:path*", headers: [...privatePage, { key: "Referrer-Policy", value: "no-referrer" }] },
    ];
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
