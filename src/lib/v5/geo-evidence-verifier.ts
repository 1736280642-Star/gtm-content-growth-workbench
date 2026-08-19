import type {
  GeoClaimAssessment,
  GeoEvidenceVerification,
  MultiSearchEvidencePack
} from "./geo-search-contracts";

function normalizeUrl(value: string) {
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(utm_|spm$|from$|source$|share_|ref$)/i.test(key)) parsed.searchParams.delete(key);
    }
    return parsed.toString();
  } catch {
    return value.trim();
  }
}

function normalizeClaim(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s，。；：、,.!?！？:;()（）【】\[\]"“”'‘’]/g, "")
    .slice(0, 240);
}

function readUrlArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map(normalizeUrl)
    : [];
}

export function pruneGeoResearchCitations(
  structured: Record<string, unknown>,
  evidencePack: MultiSearchEvidencePack
) {
  const allowedUrls = new Set(evidencePack.candidates.map((item) => normalizeUrl(item.canonicalUrl)));
  const output = structuredClone(structured);
  let removedInvalidUrls = 0;
  let removedUncitedItems = 0;
  const pruneCollection = (key: "questions" | "competitors" | "tests", citationKey: "sourceUrls" | "citedUrls") => {
    if (!Array.isArray(output[key])) return;
    output[key] = output[key].flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        removedUncitedItems += 1;
        return [];
      }
      const record = { ...(item as Record<string, unknown>) };
      const before = readUrlArray(record[citationKey]);
      const after = [...new Set(before.filter((url) => allowedUrls.has(url)))];
      removedInvalidUrls += before.length - after.length;
      if (!after.length) {
        removedUncitedItems += 1;
        return [];
      }
      record[citationKey] = after;
      return [record];
    });
  };
  pruneCollection("questions", "sourceUrls");
  pruneCollection("competitors", "sourceUrls");
  pruneCollection("tests", "citedUrls");
  // 选型替代格局（顶层：live_competitor_discovery）：无合法引用即删除，与竞品同规则
  if (Array.isArray(output.selectionAlternatives)) {
    output.selectionAlternatives = output.selectionAlternatives.flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        removedUncitedItems += 1;
        return [];
      }
      const record = { ...(item as Record<string, unknown>) };
      const before = readUrlArray(record.sourceUrls);
      const after = [...new Set(before.filter((url) => allowedUrls.has(url)))];
      removedInvalidUrls += before.length - after.length;
      if (!after.length) {
        removedUncitedItems += 1;
        return [];
      }
      record.sourceUrls = after;
      return [record];
    });
  }
  // 选型对比维度证据（顶层）：修剪 URL；available 但无合法引用降级为 missing（软修正，不删条目）
  if (Array.isArray(output.comparisonDimensionEvidence)) {
    output.comparisonDimensionEvidence = output.comparisonDimensionEvidence.flatMap((item) => {
      const record = item && typeof item === "object" && !Array.isArray(item)
        ? { ...(item as Record<string, unknown>) }
        : undefined;
      if (!record) return [];
      const before = readUrlArray(record.sourceUrls);
      const after = [...new Set(before.filter((url) => allowedUrls.has(url)))];
      removedInvalidUrls += before.length - after.length;
      record.sourceUrls = after;
      if (!after.length && record.evidenceStatus === "available") record.evidenceStatus = "missing";
      return [record];
    });
  }
  // 蓝图 competitorLandscape 内嵌集合：selectionAlternatives 修剪、comparisonDimensionEvidence 修剪
  if (output.competitorLandscape && typeof output.competitorLandscape === "object" && !Array.isArray(output.competitorLandscape)) {
    const landscape = { ...(output.competitorLandscape as Record<string, unknown>) };
    if (Array.isArray(landscape.selectionAlternatives)) {
      landscape.selectionAlternatives = landscape.selectionAlternatives.flatMap((item) => {
        const record = item && typeof item === "object" && !Array.isArray(item)
          ? { ...(item as Record<string, unknown>) }
          : undefined;
        if (!record) {
          removedUncitedItems += 1;
          return [];
        }
        const before = readUrlArray(record.sourceUrls);
        const after = [...new Set(before.filter((url) => allowedUrls.has(url)))];
        removedInvalidUrls += before.length - after.length;
        if (!after.length) {
          removedUncitedItems += 1;
          return [];
        }
        record.sourceUrls = after;
        return [record];
      });
    }
    if (Array.isArray(landscape.comparisonDimensionEvidence)) {
      landscape.comparisonDimensionEvidence = landscape.comparisonDimensionEvidence.flatMap((item) => {
        const record = item && typeof item === "object" && !Array.isArray(item)
          ? { ...(item as Record<string, unknown>) }
          : undefined;
        if (!record) return [];
        const before = readUrlArray(record.sourceUrls);
        const after = [...new Set(before.filter((url) => allowedUrls.has(url)))];
        removedInvalidUrls += before.length - after.length;
        record.sourceUrls = after;
        if (!after.length && record.evidenceStatus === "available") record.evidenceStatus = "missing";
        return [record];
      });
    }
    output.competitorLandscape = landscape;
  }
  // platformStrategy[].evidenceBasis.sourceUrls：修剪；清空后无 candidateIds 支撑则标 hypothesis（软降级）
  if (Array.isArray(output.platformStrategy)) {
    output.platformStrategy = output.platformStrategy.flatMap((item) => {
      const record = item && typeof item === "object" && !Array.isArray(item)
        ? { ...(item as Record<string, unknown>) }
        : undefined;
      if (!record) return [];
      const basis = record.evidenceBasis && typeof record.evidenceBasis === "object" && !Array.isArray(record.evidenceBasis)
        ? { ...(record.evidenceBasis as Record<string, unknown>) }
        : undefined;
      if (!basis) {
        record.hypothesis = true;
        return [record];
      }
      const before = readUrlArray(basis.sourceUrls);
      const after = [...new Set(before.filter((url) => allowedUrls.has(url)))];
      removedInvalidUrls += before.length - after.length;
      basis.sourceUrls = after;
      record.evidenceBasis = basis;
      const hasCandidateIds = Array.isArray(basis.candidateIds) && basis.candidateIds.length > 0;
      if (!after.length && !hasCandidateIds) record.hypothesis = true;
      return [record];
    });
  }
  if (Array.isArray(output.claimAssessments)) {
    output.claimAssessments = output.claimAssessments.flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        removedUncitedItems += 1;
        return [];
      }
      const record = { ...(item as Record<string, unknown>) };
      const before = readUrlArray(record.sourceUrls);
      const after = [...new Set(before.filter((url) => allowedUrls.has(url)))];
      removedInvalidUrls += before.length - after.length;
      if (!after.length) {
        removedUncitedItems += 1;
        return [];
      }
      record.sourceUrls = after;
      return [record];
    });
  }
  return { structured: output, removedInvalidUrls, removedUncitedItems };
}

function requiredCitationCollections(structured: Record<string, unknown>) {
  const collections: Array<{ path: string; items: unknown[]; citationKey: "sourceUrls" | "citedUrls" }> = [];
  if (Array.isArray(structured.questions)) collections.push({ path: "questions", items: structured.questions, citationKey: "sourceUrls" });
  if (Array.isArray(structured.competitors)) collections.push({ path: "competitors", items: structured.competitors, citationKey: "sourceUrls" });
  if (Array.isArray(structured.tests)) collections.push({ path: "tests", items: structured.tests, citationKey: "citedUrls" });
  return collections;
}

function parseClaims(value: unknown): GeoClaimAssessment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const claim = typeof record.claim === "string" ? record.claim.trim() : "";
    const stance = record.stance;
    const sourceUrls = readUrlArray(record.sourceUrls);
    const confidence = typeof record.confidence === "number" && Number.isFinite(record.confidence)
      ? Math.min(1, Math.max(0, record.confidence))
      : 0;
    if (!claim || !["supports", "opposes", "conditional"].includes(String(stance))) return [];
    return [{ claim, stance: stance as GeoClaimAssessment["stance"], sourceUrls, confidence }];
  });
}

export function verifyGeoResearchEvidence(
  structured: Record<string, unknown>,
  evidencePack: MultiSearchEvidencePack
): GeoEvidenceVerification {
  const allowedUrls = new Set(evidencePack.candidates.map((item) => normalizeUrl(item.canonicalUrl)));
  const citedUrls = new Set<string>();
  const invalidUrls = new Set<string>();
  const missingCitationPaths: string[] = [];

  for (const collection of requiredCitationCollections(structured)) {
    collection.items.forEach((item, index) => {
      const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
      const urls = readUrlArray(record[collection.citationKey]);
      if (!urls.length) missingCitationPaths.push(`${collection.path}[${index}].${collection.citationKey}`);
      urls.forEach((url) => {
        citedUrls.add(url);
        if (!allowedUrls.has(url)) invalidUrls.add(url);
      });
    });
  }

  const claims = parseClaims(structured.claimAssessments);
  claims.forEach((claim, index) => {
    if (!claim.sourceUrls.length) missingCitationPaths.push(`claimAssessments[${index}].sourceUrls`);
    claim.sourceUrls.forEach((url) => {
      citedUrls.add(url);
      if (!allowedUrls.has(url)) invalidUrls.add(url);
    });
  });

  const stancesByClaim = new Map<string, Set<GeoClaimAssessment["stance"]>>();
  claims.forEach((claim) => {
    const key = normalizeClaim(claim.claim);
    const values = stancesByClaim.get(key) || new Set<GeoClaimAssessment["stance"]>();
    values.add(claim.stance);
    stancesByClaim.set(key, values);
  });
  const verifiedClaims = claims.map((claim) => {
    const normalizedClaim = normalizeClaim(claim.claim);
    const stances = stancesByClaim.get(normalizedClaim) || new Set();
    const status = stances.has("supports") && stances.has("opposes")
      ? "conflicted" as const
      : claim.stance === "supports"
        ? "supported" as const
        : claim.stance === "opposes"
          ? "opposed" as const
          : "conditional" as const;
    return { ...claim, normalizedClaim, status };
  });
  const gaps = [
    invalidUrls.size ? `${invalidUrls.size} 个引用 URL 不属于本次搜索证据` : undefined,
    missingCitationPaths.length ? `${missingCitationPaths.length} 个结果缺少可核验引用` : undefined
  ].filter((item): item is string => Boolean(item));
  return {
    decision: gaps.length ? "blocked" : "passed",
    citedUrls: [...citedUrls].sort(),
    invalidUrls: [...invalidUrls].sort(),
    missingCitationPaths,
    verifiedClaims,
    gaps
  };
}
