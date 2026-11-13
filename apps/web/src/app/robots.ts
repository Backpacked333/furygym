import type { MetadataRoute } from "next";

// Only the public catalogue is for search engines.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/account", "/display", "/api", "/auth", "/checkout", "/reset-password"],
    },
  };
}
