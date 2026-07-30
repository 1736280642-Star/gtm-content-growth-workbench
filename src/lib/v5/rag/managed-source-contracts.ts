// Product scope comes from product_entity. A compile-time allowlist would make
// every new product require a code release and break GEO onboarding.
export type ManagedKnowledgeProductId = string;

export const MANAGED_SOURCE_AUTHORITY_LEVELS = ["A2", "B1", "B2"] as const;
export type ManagedSourceAuthorityLevel = typeof MANAGED_SOURCE_AUTHORITY_LEVELS[number];
