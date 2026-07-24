"use client";

import { Button } from "antd";
import type { ButtonProps } from "antd";
import Link from "next/link";
import { useWorkbenchSnapshot } from "@/lib/client-state";
import { canViewRoute } from "@/lib/permissions";

interface GovernanceEntryProps {
  label?: string;
  restrictedLabel?: string;
  reason?: string;
  size?: ButtonProps["size"];
  type?: ButtonProps["type"];
}

export function GovernanceEntry({
  label = "看配置管理",
  restrictedLabel = "切换角色",
  size = "small",
  type
}: GovernanceEntryProps) {
  const {
    state: { workspaceSetting }
  } = useWorkbenchSnapshot();
  const canOpenGovernance = canViewRoute(workspaceSetting.currentRole, "/configuration");

  if (canOpenGovernance) {
    return (
      <Link href="/configuration">
        <Button size={size} type={type}>
          {label}
        </Button>
      </Link>
    );
  }

  return (
    <Link href="/settings">
      <Button size={size}>{restrictedLabel}</Button>
    </Link>
  );
}
