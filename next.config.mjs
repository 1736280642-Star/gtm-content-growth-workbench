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
      { source: "/geo-monitor", destination: "/content-monitor", permanent: false },
      { source: "/publishing", destination: "/content-monitor?tab=content", permanent: false },
      { source: "/publish", destination: "/content-monitor?tab=content", permanent: false },
      { source: "/blog-monitor", destination: "/content-monitor?tab=website", permanent: false },
      { source: "/monthly-review", destination: "/content-monitor?tab=ai", permanent: false },
      { source: "/ai-front-test", destination: "/content-monitor?tab=ai", permanent: false },
      { source: "/configuration", destination: "/settings?tab=models", permanent: false },
      { source: "/operations", destination: "/settings?tab=logs&system=1", permanent: false },
      { source: "/blog-candidates", destination: "/content-monitor?tab=website", permanent: false }
    ];
  },
  async headers() {
    if (process.env.NODE_ENV !== "production") return [];
    return [{ source: "/_next/static/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] }];
  }
};

export default nextConfig;
