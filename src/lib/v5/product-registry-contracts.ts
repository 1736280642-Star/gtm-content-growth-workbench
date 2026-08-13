export type ProductRegistryStatus = "active" | "deprecated" | "archived";

export interface ProductRegistryItem {
  productId: string;
  entityRelationship?: string;
  canonicalName: string;
  displayName: string;
  brandName?: string;
  officialEntity?: string;
  officialUrl?: string;
  productCategory?: string;
  aliases: string[];
  status: ProductRegistryStatus;
  rowVersion: number;
  confirmedBy?: string;
  confirmedAt?: string;
  isPromoting?: boolean;
  promotionStatus?: string;
  strategyPackId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProductRegistryInput {
  canonicalName: string;
  entityRelationship?: string;
  displayName?: string;
  brandName?: string;
  officialEntity?: string;
  officialUrl?: string;
  productCategory?: string;
  aliases?: string[];
}

export interface UpdateProductRegistryInput {
  canonicalName: string;
  entityRelationship?: string;
  displayName: string;
  brandName?: string;
  officialEntity?: string;
  officialUrl?: string;
  productCategory?: string;
  aliases: string[];
  knowledgeProfile?: ProductKnowledgeProfileOverrideInput;
}

export interface ProductKnowledgeProfileOverrideInput {
  positioning: string[];
  audiences: string[];
  capabilities: string[];
  scenarios: string[];
  boundaries: string[];
  sourceFactCount: number;
}

