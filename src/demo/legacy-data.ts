import { createDemoState } from "./fixtures/core";
import { legacySnapshot } from "./legacy-snapshot";
const snapshot = legacySnapshot(createDemoState());
export const { tasks, drafts, publishRecords, blogArticles, botVisits, knowledgeBases } = snapshot.state;
