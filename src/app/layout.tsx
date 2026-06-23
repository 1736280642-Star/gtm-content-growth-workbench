import "antd/dist/reset.css";
import "./globals.css";
import { AppShell } from "@/components/AppShell";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "JOTO GTM 内容工作台",
  description: "JOTO GTM 内容工作台 MVP"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}

