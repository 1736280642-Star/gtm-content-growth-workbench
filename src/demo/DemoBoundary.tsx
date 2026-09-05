"use client";
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
export function DemoBoundary({ children }: {
    children: ReactNode;
}) {
    const [ready, setReady] = useState(false);
    const [error, setError] = useState("");
    useEffect(() => { import("./browser-runtime").then(module => { module.installDemoRuntime(); setReady(true); }).catch(() => setError("演示数据初始化失败。请允许此站点使用浏览器存储，再刷新页面。")); }, []);
    return <>{ready ? children : <div role="status" style={{ padding: 40 }}>{error || "正在准备演示资料…"}</div>}<aside aria-label="演示模式" style={{ position: "fixed", zIndex: 1200, right: 14, bottom: 10, padding: "6px 12px", background: "#fff", border: "1px solid #cfdcd5", borderRadius: 8, fontSize: 12, color: "#43554b", boxShadow: "0 2px 8px #0001" }}>Demo · 虚拟执行，请勿输入真实资料或凭证 · <Link href="/demo-control">场景与演示邮件</Link></aside></>;
}
