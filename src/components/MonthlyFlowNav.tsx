"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const steps: ReadonlyArray<{ href: string; label: string; exact?: boolean }> = [
  { href: "/monthly-plan?step=strategy", label: "月度策略" },
  { href: "/monthly-plan?step=tasks", label: "内容任务" },
  { href: "/monthly-plan?step=generation", label: "内容生成" },
  { href: "/monthly-plan?step=execution", label: "自动排程与执行" }
] as const;

export function MonthlyFlowNav() {
  const pathname = usePathname();

  if (pathname === "/monthly-plan") return null;

  return (
    <nav className="v5-monthly-flow-rail" aria-label="月度内容生产四步流程">
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
