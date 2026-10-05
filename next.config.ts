import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Mini-session booking system: native/WASM packages must not be bundled, and the SQL migrations must ship with the server.
  serverExternalPackages: ["@electric-sql/pglite", "pg", "sharp"],
  outputFileTracingIncludes: { "/*": ["./migrations/**/*"] },
  async headers() {
    return [
      {
        // Private booking pages: never leak URLs to other sites, never index.
        source: "/:path(manage|booked|admin|demo-pay|api)/:rest*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
  async redirects() {
    return [
      { source: "/home.html", destination: "/", permanent: true },
      { source: "/pricing.html", destination: "/pricing", permanent: true },
      { source: "/weddings.html", destination: "/weddings", permanent: true },
      { source: "/about-us.html", destination: "/about-us", permanent: true },
      { source: "/contact-me.html", destination: "/contact-me", permanent: true },
      { source: "/restoring-project.html", destination: "/restoring-project", permanent: true },
    ];
  },
};

export default nextConfig;
