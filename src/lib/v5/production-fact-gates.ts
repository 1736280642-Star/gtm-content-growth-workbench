import type { ProductionEntityIdentitySnapshot } from "./content-production-contracts";

function escapePattern(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function missingRequiredCoreClaimIds(requiredClaimIds: string[], coveredClaimIds: Iterable<string>) {
  const covered = new Set(coveredClaimIds);
  return requiredClaimIds.filter((claimId) => !covered.has(claimId));
}

export function entityRelationshipBlockers(markdown: string, identity: ProductionEntityIdentitySnapshot) {
  const blockers: string[] = [];
  const productNames = Array.from(new Set([identity.canonicalName, identity.displayName].filter(Boolean)));
  if (!productNames.some((name) => markdown.toLocaleLowerCase().includes(name.toLocaleLowerCase()))) {
    blockers.push(`正文没有正确使用目标产品名称：${identity.displayName || identity.canonicalName}。`);
  }
  for (const name of productNames) {
    const product = escapePattern(name);
    const conflicts = [
      new RegExp(`${product}\\s*[×xX]\\s*JOTO`, "i"),
      new RegExp(`JOTO\\s*[×xX]\\s*${product}`, "i"),
      new RegExp(`JOTO[^。！？\\n]{0,12}(?:旗下|推出|研发|开发|所有|拥有)[^。！？\\n]{0,12}${product}`, "i"),
      new RegExp(`${product}[^。！？\\n]{0,16}(?:属于|隶属于)\\s*JOTO`, "i")
    ];
    if (conflicts.some((pattern) => pattern.test(markdown))) {
      blockers.push(`正文混淆了 ${name} 的产品归属与 JOTO 的服务角色。`);
      break;
    }
  }
  return blockers;
}
