import type { ProductRegistryItem } from "./product-registry-contracts";
import type { ProductionMatrixTask } from "./monthly-workspace-contracts";

function normalizeIdentity(value: unknown) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[×✕＊*]/g, "x")
    .replace(/[\s\p{P}\p{S}_]+/gu, "");
}

function productIdentityTerms(product: ProductRegistryItem) {
  return Array.from(new Set([
    product.productId,
    product.canonicalName,
    product.displayName,
    product.officialEntity,
    ...(product.aliases || [])
  ].map(normalizeIdentity).filter(Boolean)));
}

export function resolveProductionTaskProduct(
  task: ProductionMatrixTask,
  products: ProductRegistryItem[]
): ProductRegistryItem | undefined {
  const direct = products.find((product) => product.productId === task.productId);
  if (direct) return direct;

  const identifiers = [task.productId, task.productNameSnapshot]
    .map(normalizeIdentity)
    .filter(Boolean);
  const exactMatches = products.filter((product) => {
    const terms = productIdentityTerms(product);
    return identifiers.some((identifier) => terms.includes(identifier));
  });
  if (exactMatches.length === 1) return exactMatches[0];

  const context = normalizeIdentity(`${task.question} ${task.title}`);
  const contextualMatches = products.filter((product) => productIdentityTerms(product)
    .some((term) => term.length >= 5 && context.includes(term)));
  return contextualMatches.length === 1 ? contextualMatches[0] : undefined;
}

export function attributeProductionTaskProducts(
  tasks: ProductionMatrixTask[],
  products: ProductRegistryItem[]
) {
  if (!products.length) return tasks;
  return tasks.map((task) => {
    const product = resolveProductionTaskProduct(task, products);
    return product ? {
      ...task,
      productId: product.productId,
      productNameSnapshot: product.displayName
    } : task;
  });
}
