"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const steps: ReadonlyArray<{ href: string; label: string; exact?: boolean }> = [
  { href: "/monthly-plan?step=strategy", label: "内容策略" },
  { href: "/monthly-plan?step=production", label: "文章任务编排" },
  { href: "/monthly-plan?step=execution", label: "生成与发布" }
] as const;

export function MonthlyFlowNav() {
  const pathname = usePathname();

  if (pathname === "/monthly-plan") return null;

  return (
    <nav className="v5-monthly-flow-rail" aria-label="月度内容生产三步流程">
      {steps.map((step, index) => {
        const active = step.exact ? pathname === step.href : false;
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
