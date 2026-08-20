import { NextResponse } from "next/server";
import { parseKnowledgeDocumentFile } from "@/lib/knowledge-document-parser";
import { parseKnowledgeSourcesForPreview } from "@/lib/workbench-store";
import { readTrustedServerActor, v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { listHostedChannelOptions } from "@/lib/v5/hosted-channel-service";
import type { HostedChannelPreference, HostedMaterialSummary } from "@/lib/v5/hosted-managed-contracts";
import { createHostedPromotionOrder } from "@/lib/v5/hosted-managed-service";
import { V5GovernanceServiceError } from "@/lib/v5/knowledge-governance-service";
import { getActiveProduct, onboardProductForGeoResearch } from "@/lib/v5/product-registry-service";
import { importManagedSources, type ManagedSourceInput } from "@/lib/v5/rag/managed-source-import-service";
import { enqueueHostedNotification } from "@/lib/v5/hosted-notification-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_FILES = 10;
const MAX_FILE_BYTES = 20 * 1024 * 1024;

function field(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function readChannels(value: string): HostedChannelPreference[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new V5GovernanceServiceError("invalid_contract", "推广渠道格式无效。", 400);
  }
  if (!Array.isArray(parsed)) throw new V5GovernanceServiceError("invalid_contract", "请选择推广渠道。", 400);
  return parsed.map((item) => {
    if (typeof item === "string") return { channel: item };
    const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const dailyCap = record.dailyCap === undefined || record.dailyCap === null || record.dailyCap === ""
      ? undefined
      : Number(record.dailyCap);
    return { channel: String(record.channel || "").trim(), dailyCap };
  });
}

function actorForHostedRequest() {
  const trusted = readTrustedServerActor("product_owner");
  if (process.env.NODE_ENV === "production" && !trusted) {
    throw new V5GovernanceServiceError(
      "authorization_not_configured",
      "生产环境尚未配置可信用户身份，系统已阻止创建托管任务。",
      503,
      "配置 V5 可信服务端身份后重试。"
    );
  }
  return trusted || {
    actorId: "local-workbench-user",
    actorRole: "product_owner",
    actorType: "human" as const,
    auditReason: "用户通过托管入口提交产品资料与推广渠道"
  };
}

async function parseSubmittedSources(officialUrl: string, files: File[]) {
  const [urlPreview, parsedFiles] = await Promise.all([
    officialUrl
      ? parseKnowledgeSourcesForPreview({ name: officialUrl, title: officialUrl, urlsText: officialUrl })
      : Promise.resolve(undefined),
    Promise.all(files.map(async (file) => ({ file, document: await parseKnowledgeDocumentFile(file) })))
  ]);
  const sources: ManagedSourceInput[] = [];
  const failedSources: Array<{ name: string; reason: string }> = [];
  for (const source of urlPreview?.data?.sources || []) {
    if (source.status === "parsed" && source.markdown.trim()) {
      sources.push({
        sourceKey: source.url || source.id,
        title: source.title,
        markdown: source.markdown,
        canonicalUrl: source.url,
        rawContent: Buffer.from(source.extractedText, "utf8"),
        mimeType: "text/markdown",
        originalFileName: source.url
      });
    } else {
      failedSources.push({ name: source.url || officialUrl, reason: source.errorMessage || "官网正文解析失败。" });
    }
  }
  for (const { file, document } of parsedFiles) {
    if (document.status === "parsed" && document.markdown.trim()) {
      sources.push({
        sourceKey: file.name,
        title: file.name,
        markdown: document.markdown,
        rawContent: Buffer.from(await file.arrayBuffer()),
        mimeType: file.type || "application/octet-stream",
        originalFileName: file.name
      });
    } else {
      failedSources.push({ name: file.name, reason: document.errorMessage || "文件正文解析失败。" });
    }
  }
  return { sources, failedSources };
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const idempotencyKey = String(request.headers.get("x-idempotency-key") || field(formData, "idempotencyKey")).trim();
    const selectedProductId = field(formData, "productId");
    const productName = field(formData, "productName");
    const officialUrl = field(formData, "officialUrl");
    const contactEmail = field(formData, "contactEmail");
    const timezone = field(formData, "timezone") || "Asia/Shanghai";
    const channels = readChannels(field(formData, "channels"));
    const files = formData.getAll("files").filter((value): value is File => value instanceof File && value.size > 0);
    if (files.length > MAX_FILES) throw new V5GovernanceServiceError("too_many_files", `一次最多上传 ${MAX_FILES} 个文件。`, 400);
    if (files.some((file) => file.size > MAX_FILE_BYTES)) throw new V5GovernanceServiceError("file_too_large", "单个文件不能超过 20 MB。", 413);
    if (!selectedProductId && !productName) throw new V5GovernanceServiceError("product_required", "请选择产品或填写新产品名称。", 400);
    if (!selectedProductId && !officialUrl && !files.length) throw new V5GovernanceServiceError("material_required", "新产品至少需要官网链接或一份产品资料。", 400);

    const baseChannelOptions = await listHostedChannelOptions();
    const baseOptionsByKey = new Map(baseChannelOptions.map((item) => [item.channel, item]));
    const invalidChannels = channels.filter((item) => baseOptionsByKey.get(item.channel)?.capability === "unsupported" || !baseOptionsByKey.has(item.channel));
    if (invalidChannels.length) {
      throw new V5GovernanceServiceError(
        "hosted_channel_unavailable",
        `以下渠道尚未具备托管规则：${invalidChannels.map((item) => item.channel).join("、")}。`,
        409,
        "改选可托管渠道，或由运营人员激活渠道规则。"
      );
    }

    const actor = actorForHostedRequest();
    const product = selectedProductId
      ? await getActiveProduct(selectedProductId)
      : (await onboardProductForGeoResearch({
          idempotencyKey: `${idempotencyKey}:onboard`.slice(0, 96),
          actor,
          product: {
            canonicalName: productName,
            displayName: productName,
            officialUrl: officialUrl || undefined
          },
          research: {
            expressionFocus: "基于受治理产品事实，回答目标用户真实的选型、采用与落地问题。",
            forbiddenFocus: ["未经证实的价格、案例、回报、性能和竞品结论"],
            researchMarkets: ["中国大陆"],
            languages: ["zh-CN"],
            targetChannels: channels.map((item) => item.channel)
          }
        })).product;

    const availableChannels = await listHostedChannelOptions(product.productId);
    const optionsByKey = new Map(availableChannels.map((item) => [item.channel, item]));
    const unavailable = channels.filter((item) => optionsByKey.get(item.channel)?.capability === "unsupported" || !optionsByKey.has(item.channel));
    if (unavailable.length) {
      throw new V5GovernanceServiceError(
        "hosted_channel_unavailable",
        `以下渠道尚未具备托管规则：${unavailable.map((item) => item.channel).join("、")}。`,
        409,
        "改选可托管渠道，或由运营人员激活渠道规则。"
      );
    }

    const parsed = await parseSubmittedSources(officialUrl, files);
    let importStatus: HostedMaterialSummary["importStatus"] = parsed.sources.length ? "queued" : "not_required";
    if (parsed.sources.length) {
      const imported = await importManagedSources({
        knowledgeBaseName: `${product.displayName} 产品资料`,
        productId: product.productId,
        authorityLevel: "A2",
        publicUseConfirmed: true,
        sources: parsed.sources,
        idempotencyKey: `${idempotencyKey}:materials`.slice(0, 128),
        actor: { ...actor, auditReason: "用户确认托管资料可用于公开内容生产" }
      });
      importStatus = imported.pipelineStatus;
    } else if (!selectedProductId || officialUrl || files.length) {
      importStatus = "needs_attention";
    }

    const materialSummary: HostedMaterialSummary = {
      officialUrl: officialUrl || product.officialUrl,
      fileNames: files.map((file) => file.name),
      acceptedSourceCount: parsed.sources.length,
      failedSources: parsed.failedSources,
      importStatus
    };
    const created = await createHostedPromotionOrder({
      productId: product.productId,
      contactEmail,
      channels,
      materialSummary,
      timezone,
      status: importStatus === "needs_attention" ? "action_required" : "preparing",
      idempotencyKey,
      actorId: actor.actorId
    });
    await enqueueHostedNotification({
      orderId: created.order.orderId,
      eventType: "order_received",
      recipientEmail: created.order.contactEmail,
      dedupeKey: `order_received:${created.order.orderId}`,
      payload: {
        productName: created.order.productName,
        actionPath: `/hosted/success?orderId=${encodeURIComponent(created.order.orderId)}`
      }
    });
    return NextResponse.json({ ok: true, ...created }, { status: created.replayed ? 200 : 201 });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
