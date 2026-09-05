import path from "node:path";
const demoMode = process.env.APP_RUNTIME_MODE === "demo";
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  distDir: process.env.NEXT_DIST_DIR || ".next",
  assetPrefix: process.env.NEXT_ASSET_PREFIX || undefined,
  ...(demoMode ? { outputFileTracingExcludes: { "/*": [".env*", "./data/**/*", "./runtime/**/*", "./保存/**/*"] } } : { output: "standalone" }),
  compress: true,
  poweredByHeader: false,
  env: { APP_RUNTIME_MODE: demoMode ? "demo" : "production", NEXT_PUBLIC_APP_RUNTIME_MODE: demoMode ? "demo" : "production" },
  webpack(config, { webpack }) {
    if (demoMode) {
      config.plugins.push(new webpack.NormalModuleReplacementPlugin(/(?:^|\/)client-state(?:\.ts)?$/, (resource) => {
        if (!resource.context.includes(`${path.sep}demo`)) resource.request = path.resolve("src/demo/client-state.ts");
      }));
      config.plugins.push(new webpack.NormalModuleReplacementPlugin(/(?:^|\/)demo-data(?:\.ts)?$/, path.resolve("src/demo/legacy-data.ts")));
      config.plugins.push(new webpack.NormalModuleReplacementPlugin(/[\\/]app[\\/]api[\\/].*[\\/]route(?:\.ts)?$/, path.resolve("src/demo/server-route.ts")));
    }
    return config;
  },
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
