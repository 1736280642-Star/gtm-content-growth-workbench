import { demoError, recordEvent, reply, type DemoReply, type DemoRequest, type DemoState } from "./model";
import { hostedRequest } from "./handlers/hosted";
import { productRequest } from "./handlers/products";
import { productionRequest } from "./handlers/production";
import { monitoringRequest } from "./handlers/monitoring";
import { systemRequest } from "./handlers/system";
import { sanitizeDemoInput } from "./privacy";
export function dispatchDemoRequest(state: DemoState, request: DemoRequest): DemoReply {
    try {
        request = { ...request, body: sanitizeDemoInput(request.body) };
        const mutating = !["GET", "HEAD"].includes(request.method);
        const key = request.headers.get("x-idempotency-key") || request.body.idempotencyKey;
        const fingerprint = JSON.stringify([request.method, request.path, request.body]);
        if (mutating && key && state.idempotency[key]) {
            if (state.idempotency[key].fingerprint !== fingerprint)
                demoError("同一操作编号不能用于不同请求，请重试。", 409, "idempotency_conflict");
            return state.idempotency[key].result as DemoReply;
        }
        const handlers = [hostedRequest, productRequest, productionRequest, monitoringRequest, systemRequest];
        let result: DemoReply | undefined;
        for (const handler of handlers) {
            result = handler(state, request);
            if (result)
                break;
        }
        if (!result)
            return reply({ ok: false, message: `演示适配尚未覆盖：${request.method} ${request.path}`, error: { code: "demo_unhandled_api", message: `演示适配尚未覆盖：${request.method} ${request.path}` } }, 501);
        if (mutating && result.status < 400) {
            state.revision += 1;
            recordEvent(state, request.method, request.path, "演示操作已保存");
            if (key) {
                state.idempotency[key] = { fingerprint, result: structuredClone(result) };
                const keys = Object.keys(state.idempotency);
                if (keys.length > 40)
                    delete state.idempotency[keys[0]];
            }
        }
        return result;
    }
    catch (cause) {
        const error = cause as Error & {
            status?: number;
            code?: string;
        };
        return reply({ ok: false, message: error.message, error: { code: error.code || "demo_adapter_error", message: error.message } }, error.status || 500);
    }
}
