import type { ProductRegistryItem } from "@/lib/v5/product-registry-contracts";
import type { ProductionMatrixTask } from "@/lib/v5/monthly-workspace-contracts";
import type { FreeContentExpressionTypeSummary, FreeProductionBatch } from "@/lib/v5/free-production-contracts";
export type DemoScenario = "populated" | "first-use" | "attention" | "completed";
export const DEMO_SCHEMA = 4;
export const DEMO_STORAGE_KEY = "gtm-demo-runtime.v1";
export const DEMO_PRODUCT_ID = "orbitdesk";
export const DEMO_ORDER_ID = "demo-order-orbitdesk";
export const DEMO_CHANNELS = ["wechat", "zhihu", "csdn", "juejin"] as const;
export const DEMO_CHANNEL_LABELS = { wechat: "微信公众号", zhihu: "知乎", csdn: "CSDN", juejin: "掘金" };
// API projections vary between the maintained legacy and V5 contracts.
// Canonical entities below remain explicit; projections are authored in each adapter.
export type DemoRecord = Record<string, any>;
export interface DemoOrder {
    orderId: string;
    productId: string;
    productName: string;
    contactEmail: string;
    contactEmailVerified: boolean;
    status: "preparing" | "pending_strategy_review" | "generating_sample" | "pending_sample_review" | "running" | "action_required" | "paused" | "completed";
    rowVersion: number;
    channels: {
        channel: string;
        dailyCap: number;
    }[];
    dailyCaps: Record<string, number>;
    notificationPreferences: {
        dailyDigest: boolean;
        monthlyCompleted: boolean;
    };
    materialSummary: {
        officialUrl: string;
        fileNames: string[];
        acceptedSourceCount: number;
        failedSources: {
            name: string;
            reason: string;
        }[];
        importStatus: string;
    };
    updatedAt: string;
    currentActionType?: string;
    lastError?: {
        code: string;
        message: string;
    };
}
export interface DemoMail {
    id: string;
    orderId: string;
    kind: "login" | "strategy" | "sample" | "digest" | "completed" | "action";
    subject: string;
    to: string;
    createdAt: string;
    href: string;
    summary: string;
    status: "simulated";
}
export interface DemoState {
    schema: typeof DEMO_SCHEMA;
    revision: number;
    scenario: DemoScenario;
    month: string;
    now: string;
    identity: {
        email: string;
        workspaceId: string;
        role: "workspace_admin";
    } | null;
    products: ProductRegistryItem[];
    orders: DemoOrder[];
    tasks: ProductionMatrixTask[];
    taskOrders: Record<string, string>;
    drafts: Record<string, DemoRecord>;
    productDetails: Record<string, DemoRecord>;
    research: Record<string, DemoRecord>;
    strategies: Record<string, DemoRecord>;
    knowledge: DemoRecord[];
    collectionSources: DemoRecord[];
    questions: DemoRecord[];
    expressions: FreeContentExpressionTypeSummary[];
    freeBatches: FreeProductionBatch[];
    articleTypes: DemoRecord[];
    expressionProfiles: DemoRecord[];
    assets: DemoRecord[];
    siteAudits: DemoRecord[];
    monitoringQuestions: DemoRecord[];
    connections: DemoRecord[];
    reviews: Record<string, DemoRecord>;
    mails: DemoMail[];
    settings: DemoRecord;
    events: {
        id: string;
        action: string;
        objectId: string;
        at: string;
        summary: string;
    }[];
    idempotency: Record<string, {
        fingerprint: string;
        result: DemoRecord;
    }>;
}
export interface DemoRequest {
    path: string;
    method: string;
    body: DemoRecord;
    headers: Headers;
}
export interface DemoReply {
    status: number;
    body: any;
}
export const reply = (body: any, status = 200): DemoReply => ({ status, body });
export const dataReply = (data: any, extra: DemoRecord = {}): DemoReply => reply({ ok: true, data, ...extra });
export function demoError(message: string, status = 422, code = "demo_invalid_request"): never {
    throw Object.assign(new Error(message), { status, code });
}
export function required<T>(value: T | undefined | null, label: string): T {
    if (value === undefined || value === null)
        demoError(`${label}不存在，请从演示控制台打开有效示例。`, 404, "demo_not_found");
    return value;
}
export function expectVersion(actual: number, expected?: number) {
    if (expected !== undefined && expected !== actual)
        demoError("记录已变化，请刷新后重试。", 409, "version_conflict");
}
export function recordEvent(state: DemoState, action: string, objectId: string, summary: string) {
    state.events.unshift({ id: `demo-event-${state.revision}-${state.events.length}`, action, objectId, at: state.now, summary });
    state.events = state.events.slice(0, 200);
}
