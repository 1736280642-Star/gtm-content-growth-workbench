import type { DemoRecord } from "./model";
// Credentials entered accidentally must not be retained in browser state or replay logs.
export function sanitizeDemoInput(input: DemoRecord): DemoRecord {
    return Object.fromEntries(Object.entries(input).map(([key, value]) => {
        if (/^(api_?key|access_?token|refresh_?token|password|client_?secret|authorization|smtpPassword|dataBase64)$/i.test(key))
            return [key, "demo-not-a-credential"];
        if (/^(email|contactEmail|senderEmail)$/i.test(key))
            return [key, typeof value === "string" && /^\S+@\S+\.\S+$/.test(value) ? "presenter@example.com" : ""];
        if (Array.isArray(value)) return [key, value.map(item => item && typeof item === "object" ? sanitizeDemoInput(item) : item)];
        if (value && typeof value === "object") return [key, sanitizeDemoInput(value)];
        return [key, value];
    }));
}
