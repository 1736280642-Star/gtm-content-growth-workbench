import { Tag } from "antd";
import { confidenceColors, confidenceLabels } from "@/lib/labels";
import type { DataConfidence } from "@/lib/types";

export function DataConfidenceTag({ value }: { value: DataConfidence }) {
  return <Tag color={confidenceColors[value]}>{confidenceLabels[value]}</Tag>;
}

