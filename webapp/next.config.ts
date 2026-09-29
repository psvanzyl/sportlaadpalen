import type { NextConfig } from "next";

const MAP_TILE_HOSTS = "https://basemaps.cartocdn.com https://*.basemaps.cartocdn.com";

const nextConfig: NextConfig = {
  compress: true,
  async headers() {
    const securityHeaders = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    ];
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      `img-src 'self' data: blob: ${MAP_TILE_HOSTS}`,
      "font-src 'self' data:",
      `connect-src 'self' ${MAP_TILE_HOSTS}`,
      "worker-src 'self' blob:",
      "child-src 'self' blob:",
    ].join("; ");

    return [
      {
        source: "/(.*)",
        headers: [
          ...securityHeaders,
          { key: "Content-Security-Policy", value: csp },
        ],
      },
      {
        source: "/data/:path*.geojson",
        headers: [
          { key: "Cache-Control", value: "public, max-age=3600, must-revalidate" },
          { key: "Content-Type", value: "application/geo+json" },
        ],
      },
      {
        source: "/data/:path*.json",
        headers: [
          { key: "Cache-Control", value: "public, max-age=3600, stale-while-revalidate=86400" },
        ],
      },
    ];
  },
};

export default nextConfig;