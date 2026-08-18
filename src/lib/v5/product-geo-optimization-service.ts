import { hasV5GovernanceDatabaseConfig } from "./knowledge-governance-repository";
import type { ProductGeoOptimizationWorkspace } from "./product-geo-optimization-contracts";
import { reconcileProductGeoOptimizations } from "./product-geo-optimization-repository";

export async function getProductGeoOptimizationWorkspace(productIds?: string[]): Promise<ProductGeoOptimizationWorkspace> {
  if (!hasV5GovernanceDatabaseConfig()) {
    return {
      source: "pending_config",
      products: [],
      generatedAt: new Date().toISOString(),
      message: "正式数据库未配置，不能把官网审计、发布存活和 AI 复测合并为优化建议。"
    };
  }
  return reconcileProductGeoOptimizations(productIds);
}
