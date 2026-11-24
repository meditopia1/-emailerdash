import type { HelpArticle } from "./types";
export const articles: HelpArticle[] = [{ id: "campaign", title: "Build a saved campaign", description: "The visual workflow and standard editor use the same campaign draft.", page: "Compose & Send", prerequisites: ["A saved sender identity.", "At least one eligible recipient."], destination: { page: "Compose & Send" }, instructions: [
  { title: "Campaign Start", text: "Name the campaign and choose its sender. This node holds campaign settings; it does not schedule or start sending." },
  { title: "Audience", text: "Choose contacts, a saved segment, static list or filters. Review currently eligible and excluded recipients, save the draft and approve the current audience. Changed draft details or eligibility require another review." },
  { title: "Email", text: "Add a subject and email content. Use the editor's personalization buttons to insert supported contact fields, then preview desktop/mobile output with sample recipients. Check missing-field fallbacks. Save content before treating the draft as prepared. You can use visual or standard mode." },
  { title: "Results", text: "Review the saved campaign and sender. Explicit single-recipient tests are separate from campaign sending. Launch queues only the approved snapshot; the worker rechecks each recipient before sending." },
] }];
