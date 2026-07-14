import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
