"use client";

import { Button, Input, Radio, Select, Upload } from "antd";
import { UploadOutlined } from "@ant-design/icons";
import type { RiskAndGapItem } from "@/lib/v5/free-production-contracts";

export type SupplementValue = string | { fileName: string; mimeType: string; dataBase64: string };

export function InlineSupplementField({ risk, value, onChange }: { risk: RiskAndGapItem; value?: SupplementValue; onChange: (value: SupplementValue) => void }) {
  const schema = risk.inputSchema;
  if (!schema) return null;
  if (schema.type === "textarea") return <Input.TextArea value={typeof value === "string" ? value : ""} maxLength={schema.maxLength} autoSize={{ minRows: 3, maxRows: 7 }} placeholder={schema.placeholder} onChange={(event) => onChange(event.target.value)} />;
  if (schema.type === "select") return <Select value={typeof value === "string" ? value : undefined} placeholder={schema.placeholder || "请选择"} options={schema.options} onChange={onChange} />;
  if (schema.type === "file") return <Upload accept={schema.acceptedMimeTypes?.join(",")} maxCount={1} beforeUpload={(file) => { const reader = new FileReader(); reader.onload = () => onChange({ fileName: file.name, mimeType: file.type, dataBase64: String(reader.result || "").split(",")[1] || "" }); reader.readAsDataURL(file); return false; }} onRemove={() => { onChange(""); return true; }}><Button icon={<UploadOutlined />}>{typeof value === "object" ? value.fileName : schema.label}</Button></Upload>;
  if (schema.type === "text" && schema.options) return <Radio.Group value={typeof value === "string" ? value : undefined} options={schema.options} onChange={(event) => onChange(event.target.value)} />;
  return <Input type={schema.type === "date" ? "date" : schema.type === "url" ? "url" : "text"} value={typeof value === "string" ? value : ""} maxLength={schema.maxLength} placeholder={schema.placeholder} onChange={(event) => onChange(event.target.value)} />;
}
