import assert from "node:assert/strict";
import test from "node:test";
import { inferProductIdentityFromConfirmedSources } from "../src/lib/v5/rag/managed-source-import-service.ts";

const noteflowHomepage = {
  sourceKey: "https://note.jotoai.com/",
  title: "Noteflow - 隐私优先的 AI 知识管理平台 | JOTO.AI",
  markdown: "# Noteflow\n\n隐私优先的 AI 知识管理平台。",
  canonicalUrl: "https://note.jotoai.com/"
};

test("Noteflow official page title resolves JOTO brand and official URL", () => {
  assert.deepEqual(inferProductIdentityFromConfirmedSources({
    authorityLevel: "A2",
    sources: [noteflowHomepage]
  }), {
    brandName: "JOTO.AI",
    officialEntity: undefined,
    officialUrl: "https://note.jotoai.com/"
  });
});

test("Noteflow privacy page can add an explicit legal entity", () => {
  assert.deepEqual(inferProductIdentityFromConfirmedSources({
    authorityLevel: "A2",
    sources: [
      noteflowHomepage,
      {
        sourceKey: "https://note.jotoai.com/privacy",
        title: "Noteflow Privacy Policy | JOTO.AI",
        markdown: "# 隐私政策\n\nCompany: 上海聚托信息科技有限公司\n\nEmail: support@jototech.cn",
        canonicalUrl: "https://note.jotoai.com/privacy"
      }
    ]
  }), {
    brandName: "JOTO.AI",
    officialEntity: "上海聚托信息科技有限公司",
    officialUrl: "https://note.jotoai.com/"
  });
});

test("non-A2 material cannot change product identity", () => {
  assert.deepEqual(inferProductIdentityFromConfirmedSources({
    authorityLevel: "B1",
    sources: [noteflowHomepage]
  }), {});
});
