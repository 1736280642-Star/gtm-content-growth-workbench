"use client";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Card, Tag, Typography } from "antd";
import { MarkdownArticle } from "@/components/MarkdownArticle";
import { readDemoState } from "@/demo/browser-runtime";
import { articleText } from "@/demo/fixtures/core";

export default function DemoArticlePage() {
  const {id}=useParams<{id:string}>();const [article,setArticle]=useState<{title:string;markdown:string}>();const [missing,setMissing]=useState(false);
  useEffect(()=>{const state=readDemoState();if(!state)return;const task=state.tasks.find(t=>t.taskId===id),batch=state.freeBatches.find(b=>b.id===id);if(task?.currentDraft)setArticle(task.currentDraft);else if(batch){const draft=batch.draftArtifacts.find(a=>a.id===batch.currentDraftArtifactId);if(draft)setArticle({title:draft.selectedTitle,markdown:draft.articleBody});}else if(id==="product-guide"||id==="demo-news")setArticle({title:id==="demo-news"?"虚拟热点：让 AI 工作过程可检查":"虚拟产品说明",markdown:articleText("OrbitDesk 协作助手",id==="demo-news"?"虚拟热点：让 AI 工作过程可检查":"虚拟产品说明")});else setMissing(true);},[id]);
  if(process.env.NEXT_PUBLIC_APP_RUNTIME_MODE!=="demo")return <p>此页面仅在演示模式可用。</p>;
  if(missing)return <p role="alert">这篇演示文章不存在。请从工作台发布结果中重新打开。</p>;
  return <Card style={{maxWidth:900,margin:"0 auto"}}><Tag color="gold">虚拟文章 · 未发布到真实平台</Tag>{article?<><Typography.Title level={2}>{article.title}</Typography.Title><MarkdownArticle markdown={article.markdown}/></>:<p>正在读取演示正文…</p>}</Card>;
}
