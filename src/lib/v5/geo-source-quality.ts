import type {
  GeoSourceQualityIssueCode,
  GeoSourceSnapshotQuality
} from "./geo-research-contracts";

export interface GeoSnapshotSourceMetadata {
  sourceId: string;
  sourceRevisionId: string;
  title?: string;
  canonicalUrl?: string;
  fileName?: string;
  documentType: string;
  authorityLevel: string;
  visibility: string;
  lifecycleStatus: string;
  status: string;
  safetyStatus: string;
}

const TEST_NAME_MARKER = /(^|[-_.\s])(smoke|fixture|mock|test[-_.\s]?(?:data|fixture)|codex[-_.\s]?config)([-_.\s]|$)/i;
const TEST_CN_MARKER = /(测试|样例|占位)(资料|数据|文档|来源)/;
const RESERVED_TEST_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "example.com", "example.org", "example.net"]);

function normalizedHttpUrl(value?: string) {
  if (!value?.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    return ["http:", "https:"].includes(url.protocol) ? url : undefined;
  } catch {
    return undefined;
  }
}

export function isTestGeoSource(source: GeoSnapshotSourceMetadata) {
  const identity = [source.title, source.fileName].filter(Boolean).join(" ");
  if (TEST_NAME_MARKER.test(identity) || TEST_CN_MARKER.test(identity)) return true;
  const url = normalizedHttpUrl(source.canonicalUrl);
  if (!url) return false;
  return RESERVED_TEST_HOSTS.has(url.hostname.toLowerCase()) || url.hostname.toLowerCase().endsWith(".invalid");
}

export function evaluateGeoSourceSnapshotQuality(input: {
  declaredSourceCount: number;
  declaredRevisionCount: number;
  sources: GeoSnapshotSourceMetadata[];
}): GeoSourceSnapshotQuality {
  const linkedSourceCount = new Set(input.sources.map((source) => source.sourceId)).size;
  const linkedRevisionCount = new Set(input.sources.map((source) => source.sourceRevisionId)).size;
  const testSourceIds = new Set(input.sources.filter(isTestGeoSource).map((source) => source.sourceId));
  const eligiblePublicSources = input.sources.filter((source) => {
    const url = normalizedHttpUrl(source.canonicalUrl);
    return Boolean(
      url
      && !isTestGeoSource(source)
      && source.visibility === "public"
      && source.lifecycleStatus === "current"
      && source.status === "approved_for_claim_extraction"
      && source.safetyStatus === "passed"
    );
  });
  const publicCitableSourceCount = new Set(eligiblePublicSources.map((source) => source.sourceId)).size;
  const officialSourceCount = new Set(
    eligiblePublicSources
      .filter((source) => ["A1", "A2"].includes(source.authorityLevel))
      .map((source) => source.sourceId)
  ).size;
  const issueCodes: GeoSourceQualityIssueCode[] = [];
  const issues: string[] = [];
  const addIssue = (code: GeoSourceQualityIssueCode, detail: string) => {
    issueCodes.push(code);
    issues.push(detail);
  };

  if (linkedSourceCount !== input.declaredSourceCount) {
    addIssue("snapshot_source_mismatch", `快照声明 ${input.declaredSourceCount} 个资料源，但只关联到 ${linkedSourceCount} 个有效来源。`);
  }
  if (linkedRevisionCount !== input.declaredRevisionCount) {
    addIssue("snapshot_revision_mismatch", `快照声明 ${input.declaredRevisionCount} 个资料版本，但只关联到 ${linkedRevisionCount} 个有效版本。`);
  }
  if (testSourceIds.size > 0) {
    addIssue("test_source_detected", `快照包含 ${testSourceIds.size} 个测试、fixture 或占位来源，不能进入正式 GEO 调研。`);
  }
  if (publicCitableSourceCount === 0) {
    addIssue("public_citation_source_required", "至少需要一条安全通过、当前有效且具有公开原始网址的资料来源。");
  }
  if (officialSourceCount === 0) {
    addIssue("official_product_source_required", "至少需要一条 A1/A2 的公开正式产品来源，用于确认产品身份与当前能力。");
  }

  return {
    status: issueCodes.length ? "blocked" : "ready",
    linkedSourceCount,
    linkedRevisionCount,
    publicCitableSourceCount,
    officialSourceCount,
    testSourceCount: testSourceIds.size,
    issueCodes,
    issues
  };
}
