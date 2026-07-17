import type { RagPlatformContentType, RagRetrievalRoute } from "./contracts";

const base = { candidateLimits: { bm25: 30, vector: 30, relation: 20, required: 10, final: 20 }, sourcePageLimit: 3, duplicateClusterLimit: 1 };

export const ragRetrievalRoutes: Record<RagPlatformContentType, RagRetrievalRoute> = {
  explicit_product_intro: { ...base, routeId: "route-wechat-product-intro", routeVersion: "v1", platformContentType: "explicit_product_intro", requiredSemanticTypes: ["product_definition", "user_problem", "scenario", "claim_chunk", "limitation_chunk", "official_citation"], requiredEvidenceRoles: ["problem_context", "product_mechanism", "human_boundary", "official_citation"], forbiddenSupportModes: ["background_only", "unsupported"], requireOfficialCitation: true, requireLimitation: true },
  explicit_launch_matrix: { ...base, routeId: "route-wechat-launch", routeVersion: "v1", platformContentType: "explicit_launch_matrix", requiredSemanticTypes: ["release", "change_history", "claim_chunk", "limitation_chunk", "official_citation"], requiredEvidenceRoles: ["launch_or_release_fact", "product_mechanism", "human_boundary"], forbiddenSupportModes: ["background_only", "unsupported"], requireOfficialCitation: true, requireLimitation: true },
  implicit_personal_review: { ...base, routeId: "route-wechat-personal-review", routeVersion: "v1", platformContentType: "implicit_personal_review", requiredSemanticTypes: ["first_person_experience", "process", "environment", "result", "limitation_chunk"], requiredEvidenceRoles: ["first_person_experience", "human_boundary"], forbiddenSupportModes: ["unsupported"], requireOfficialCitation: false, requireLimitation: true },
  implicit_painpoint_education: { ...base, routeId: "route-wechat-painpoint", routeVersion: "v1", platformContentType: "implicit_painpoint_education", requiredSemanticTypes: ["user_problem", "scenario", "claim_chunk", "limitation_chunk", "official_citation"], requiredEvidenceRoles: ["problem_context", "product_mechanism", "human_boundary", "official_citation"], forbiddenSupportModes: ["unsupported"], requireOfficialCitation: true, requireLimitation: true },
  implicit_tool_guide: { ...base, routeId: "route-wechat-tool-guide", routeVersion: "v1", platformContentType: "implicit_tool_guide", requiredSemanticTypes: ["claim_chunk", "integration", "deployment", "faq", "method_step", "limitation_chunk"], requiredEvidenceRoles: ["product_mechanism", "method_step", "human_boundary"], forbiddenSupportModes: ["background_only", "unsupported"], requireOfficialCitation: false, requireLimitation: true },
  implicit_trend_judgment: { ...base, routeId: "route-wechat-trend", routeVersion: "v1", platformContentType: "implicit_trend_judgment", requiredSemanticTypes: ["industry_background", "change_history", "product_definition", "claim_chunk", "limitation_chunk"], requiredEvidenceRoles: ["trend_signal", "product_mechanism", "human_boundary"], forbiddenSupportModes: ["unsupported"], requireOfficialCitation: false, requireLimitation: true }
};

export function getRagRetrievalRoute(type: RagPlatformContentType) {
  return ragRetrievalRoutes[type];
}
