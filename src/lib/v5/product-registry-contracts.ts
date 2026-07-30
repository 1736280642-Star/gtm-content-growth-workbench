export type ProductRegistryStatus = "active" | "deprecated" | "archived";

export interface ProductRegistryItem {
  productId: string;
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
  createdAt: string;
  updatedAt: string;
}

export interface CreateProductRegistryInput {
  canonicalName: string;
  displayName?: string;
  brandName?: string;
  officialEntity?: string;
  officialUrl?: string;
  productCategory?: string;
  aliases?: string[];
}
