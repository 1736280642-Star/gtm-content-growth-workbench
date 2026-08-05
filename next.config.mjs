/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  distDir: process.env.NEXT_DIST_DIR || ".next",
  assetPrefix: process.env.NEXT_ASSET_PREFIX || undefined,
  output: "standalone",
  compress: true,
  poweredByHeader: false,
  async redirects() {
    return [
      { source: "/monthly-matrix", destination: "/monthly-plan?step=strategy", permanent: false },
      { source: "/monthly-matrix/strategy", destination: "/monthly-plan?step=strategy&drawer=strategy", permanent: false },
      { source: "/monthly-matrix/tasks", destination: "/monthly-plan?step=tasks", permanent: false },
      { source: "/monthly-matrix/batch-generation", destination: "/monthly-plan?step=generation", permanent: false },
      { source: "/monthly-matrix/schedule", destination: "/monthly-plan?step=execution&view=schedule", permanent: false },
      { source: "/daily-execution", destination: "/monthly-plan?step=execution&view=today", permanent: false },
      { source: "/publishing", destination: "/geo-monitor?tab=publishing", permanent: false },
      { source: "/publish", destination: "/geo-monitor?tab=ledger", permanent: false },
      { source: "/blog-monitor", destination: "/geo-monitor?tab=site", permanent: false },
      { source: "/monthly-review", destination: "/geo-monitor?tab=review", permanent: false },
      { source: "/ai-front-test", destination: "/geo-monitor?tab=ai", permanent: false },
      { source: "/configuration", destination: "/settings?tab=models", permanent: false },
      { source: "/operations", destination: "/settings?tab=logs&system=1", permanent: false },
      { source: "/blog-candidates", destination: "/geo-monitor?tab=site", permanent: false }
    ];
  },
  async headers() {
    if (process.env.NODE_ENV !== "production") return [];
    return [{ source: "/_next/static/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] }];
  }
};

export default nextConfig;
