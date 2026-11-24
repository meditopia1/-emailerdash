import { describe, expect, it } from "vitest";
import { loadHelpArticles } from "../../app/help/content/load";
import type { GuidePage } from "../guided-setup";
describe("contextual help content", () => {
  it.each<GuidePage>(["Overview", "Email Setup", "Contacts", "Compose & Send", "Active Sending", "Campaign History", "Recipient Activity", "Suppressions", "Settings"])("loads structured guidance for %s only", async page => {
    const articles = await loadHelpArticles(page); expect(articles.length).toBeGreaterThan(0);
    for (const article of articles) { expect(article.page).toBe(page); expect(article.id).toBeTruthy(); expect(article.instructions.length).toBeGreaterThan(0); expect(article.destination.page).toBe(page); if (article.link) expect(article.link.href).toMatch(/^https:\/\/resend\.com\//); }
  });
});
