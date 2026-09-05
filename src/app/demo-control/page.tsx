"use client";
import Link from "next/link";
import { Button, Card, Space, Table, Tag, Typography, Popconfirm } from "antd";
import { useEffect, useState } from "react";
import { readDemoState, resetDemoState } from "@/demo/browser-runtime";
import { demoPageCases, demoExtraCases } from "@/demo/routes";
import type { DemoScenario, DemoState } from "@/demo/model";

export default function DemoControlPage() {
  const [state,setState]=useState<DemoState>();
  useEffect(()=>{setState(readDemoState());const refresh=()=>setState({...readDemoState()});window.addEventListener("demo-state-changed",refresh);return()=>window.removeEventListener("demo-state-changed",refresh);},[]);
  if(process.env.NEXT_PUBLIC_APP_RUNTIME_MODE!=="demo")return <Typography.Paragraph>此页面仅在演示模式可用。</Typography.Paragraph>;
  if(!state)return <p>正在读取演示场景…</p>;
  return <Space direction="vertical" size={20} style={{width:"100%"}}>
    <div><Typography.Title level={2}>演示控制台</Typography.Title><Typography.Paragraph>工作台页面与 main 共用。资料、AI 输出、邮件、发布链接和指标均为虚构；不会发送真实邮件或连接生产服务。操作保存在当前浏览器，可刷新继续。</Typography.Paragraph><Link href="/"><Button type="primary">进入工作台</Button></Link></div>
    <Card title="演示场景"><Space wrap>{([['populated','完整结果'],['first-use','首次使用'],['attention','异常处理'],['completed','月末复盘']] as [DemoScenario,string][]).map(([key,label])=><Popconfirm key={key} title={`切换到${label}？`} description="会重置当前浏览器的演示操作。" okText="确认重置" cancelText="取消" onConfirm={()=>resetDemoState(key)}><Button type={state.scenario===key?"primary":"default"}>{label}</Button></Popconfirm>)}</Space><p>当前月份：{state.month} · 模拟时间：{state.now} · 状态版本：{state.revision}</p></Card>
    <Card title="演示收件箱" extra={<Tag color="gold">全部为模拟发送</Tag>}><Table rowKey="id" dataSource={state.mails} pagination={{pageSize:6}} columns={[{title:"邮件主题",dataIndex:"subject"},{title:"收件人",dataIndex:"to"},{title:"内容",dataIndex:"summary"},{title:"查看",render:(_,mail)=><Link href={mail.href}><Button size="small">打开邮件结果</Button></Link>}]} /><p>策略和样文邮件打开 main 的原审核页；结果邮件打开原每日发布结果页。</p><Link href="/hosted/preferences/demo-preferences">打开通知偏好页</Link></Card>
    <Card title={`逐页演示入口 · ${demoPageCases.length} 个原页面入口`}><Table rowKey="route" dataSource={[...demoPageCases,...demoExtraCases]} pagination={{pageSize:15}} columns={[{title:"模块",dataIndex:"group",width:100},{title:"页面",dataIndex:"route"},{title:"预期可见内容",dataIndex:"expected"},{title:"打开",render:(_,row)=><Link href={row.href}>查看页面</Link>}]} /></Card>
  </Space>;
}
