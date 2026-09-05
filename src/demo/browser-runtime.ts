import { createDemoState } from "./fixtures/core";
import { dispatchDemoRequest } from "./gateway";
import { DEMO_SCHEMA, DEMO_STORAGE_KEY, type DemoState, type DemoScenario, type DemoRecord } from "./model";
let installed = false;
let state: DemoState;
let queue: Promise<unknown> = Promise.resolve();
export function readDemoState() { return state; }
export function resetDemoState(scenario: DemoScenario = "populated") {
    state = createDemoState(scenario);
    localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(state));
    window.location.assign("/demo-control");
}
function loadState(): DemoState {
    const stored = localStorage.getItem(DEMO_STORAGE_KEY);
    if (stored) {
        try {
            const parsed = JSON.parse(stored);
            if (parsed.schema === DEMO_SCHEMA && parsed.products?.length && Array.isArray(parsed.events))
                return parsed;
        }
        catch { /* Restore a valid synthetic seed after corrupt browser storage. */ }
    }
    const initial = createDemoState();
    localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(initial));
    return initial;
}
async function requestBody(input: RequestInfo | URL, init?: RequestInit): Promise<DemoRecord> {
    const value = init?.body;
    if (value instanceof FormData) {
        const data: DemoRecord = {};
        for (const [key, entry] of value.entries()) {
            const item = typeof entry === "string" ? entry : { name: entry.name, size: entry.size, type: entry.type };
            if (key in data)
                data[key] = [...(Array.isArray(data[key]) ? data[key] : [data[key]]), item];
            else
                data[key] = item;
        }
        return data;
    }
    if (typeof value === "string") {
        try {
            return JSON.parse(value);
        }
        catch {
            return Object.fromEntries(new URLSearchParams(value));
        }
    }
    if (input instanceof Request && !["GET", "HEAD"].includes(input.method)) {
        try {
            return await input.clone().json();
        }
        catch {
            return {};
        }
    }
    return {};
}
export function installDemoRuntime() {
    if (installed)
        return;
    state = loadState();
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
        const raw = input instanceof Request ? input.url : String(input);
        const url = new URL(raw, window.location.origin);
        if (url.origin !== window.location.origin)
            return Response.json({ ok: false, error: { code: "demo_external_request_blocked", message: "演示模式不会连接真实外部服务。" } }, { status: 403 });
        if (!url.pathname.startsWith("/api/"))
            return nativeFetch(input, init);
        const headers = new Headers(input instanceof Request ? input.headers : undefined);
        new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
        const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
        const body = await requestBody(input, init);
        const signal = init?.signal || (input instanceof Request ? input.signal : undefined);
        const execute = async () => {
            if (signal?.aborted)
                throw new DOMException("Aborted", "AbortError");
            state = loadState();
            const before = state;
            const candidate = structuredClone(state);
            const result = dispatchDemoRequest(candidate, { path: url.pathname + url.search, method, body, headers });
            if (result.status < 400 && method !== "GET" && method !== "HEAD") {
                try {
                    localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(candidate));
                    state = candidate;
                }
                catch {
                    state = before;
                    return Response.json({ ok: false, error: { code: "demo_storage_full", message: "浏览器存储空间不足，请导出需要保留的演示内容后重置。" } }, { status: 507 });
                }
                window.dispatchEvent(new CustomEvent("demo-state-changed"));
            }
            window.dispatchEvent(new CustomEvent("demo-api-result", { detail: { path: url.pathname, method, status: result.status } }));
            return Response.json(result.body, { status: result.status, headers: { "X-Demo-Mode": "synthetic", "Cache-Control": "no-store" } });
        };
        // Serialize mutations and reads; also coordinate concurrent tabs when Web Locks is available.
        const work = queue.then(async () => {
            if (navigator.locks)
                return await navigator.locks.request(DEMO_STORAGE_KEY, execute);
            return await execute();
        });
        queue = work.catch(() => undefined);
        return work;
    };
    document.addEventListener("click", event => {
        const anchor = (event.target as Element)?.closest?.("a");
        if (!anchor)
            return;
        const url = new URL(anchor.href, location.origin);
        if (url.hostname !== "example.com")
            return;
        event.preventDefault();
        const href = "/demo-article/product-guide";
        if (anchor.target === "_blank")
            window.open(href, "_blank", "noopener");
        else
            location.assign(href);
    }, true);
    // <img> does not use window.fetch. Resolve its API resource from the same
    // browser-owned state without changing the production component or endpoint.
    const resolveImages = () => {
        for (const img of document.querySelectorAll<HTMLImageElement>('img[src*="/api/v5/free-production/"]')) {
            const path = new URL(img.src, location.origin).pathname;
            const cover = path.match(/\/batches\/([^/]+)\/cover$/);
            const asset = path.match(/\/assets\/([^/]+)\/content$/);
            const src = cover ? state.freeBatches.find(batch => batch.id === cover[1])?.risks.find(risk => risk.key === "wechat_cover")?.assetRef
                : asset ? state.assets.find(item => item.id === asset[1])?.contentUrl : undefined;
            if (typeof src === "string" && src.startsWith("/demo-assets/")) img.src = src;
        }
    };
    new MutationObserver(resolveImages).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["src"] });
    window.addEventListener("demo-state-changed", resolveImages);
    resolveImages();
    installed = true;
}
