import { demoId } from "./config";
import { DEMO_OUTBOX_KEY, demoRead, demoWrite } from "./store";

export interface DemoEmailRecord {
  id: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  idempotencyKey?: string;
  sentAt: string;
}

const OUTBOX_LIMIT = 50;

/** 记录一封演示邮件到内存收件箱，返回模拟 messageId。 */
export function recordDemoEmail(input: {
  to: string;
  subject: string;
  text: string;
  html: string;
  idempotencyKey?: string;
}): string {
  const record: DemoEmailRecord = {
    id: demoId("mail"),
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
    idempotencyKey: input.idempotencyKey,
    sentAt: new Date().toISOString()
  };
  const outbox = demoRead<DemoEmailRecord[]>(DEMO_OUTBOX_KEY, () => []);
  outbox.unshift(record);
  demoWrite(DEMO_OUTBOX_KEY, outbox.slice(0, OUTBOX_LIMIT));
  return record.id;
}

export function listDemoEmails(): DemoEmailRecord[] {
  return demoRead<DemoEmailRecord[]>(DEMO_OUTBOX_KEY, () => []);
}
