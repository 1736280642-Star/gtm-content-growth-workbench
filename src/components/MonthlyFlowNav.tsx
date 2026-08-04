"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const steps: ReadonlyArray<{ href: string; label: string; exact?: boolean }> = [
  { href: "/monthly-matrix", label: "内容策略包", exact: true },
  { href: "/monthly-matrix/tasks", label: "矩阵任务" },
  { href: "/monthly-matrix/batch-generation", label: "内容生成" },
  { href: "/monthly-matrix/schedule", label: "人工排程" }
] as const;

export function MonthlyFlowNav() {
  const pathname = usePathname();

  return (
    <nav className="v5-monthly-flow-rail" aria-label="月度内容生产四步流程">
      {steps.map((step, index) => {
        const active = step.exact ? pathname === step.href : pathname.startsWith(step.href);
        return (
          <Link key={step.href} href={step.href} className={active ? "is-active" : undefined} aria-current={active ? "step" : undefined}>
            <span className="v5-flow-step-index">{index + 1}</span>
            <span>{step.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
