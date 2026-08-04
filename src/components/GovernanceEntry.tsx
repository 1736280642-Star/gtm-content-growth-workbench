"use client";

import { Button } from "antd";
import type { ButtonProps } from "antd";
import Link from "next/link";

interface GovernanceEntryProps {
  label?: string;
  size?: ButtonProps["size"];
  type?: ButtonProps["type"];
}

export function GovernanceEntry({
  label = "看配置管理",
  size = "small",
  type
}: GovernanceEntryProps) {
  return (
    <Link href="/settings?tab=connections">
      <Button size={size} type={type}>{label}</Button>
    </Link>
  );
}
