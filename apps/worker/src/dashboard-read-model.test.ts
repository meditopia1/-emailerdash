import { describe, expect, it, vi } from "vitest";
import { embeddedCount, storedClickUrl } from "../../web/lib/dashboard-read-model";
import { databaseFetch } from "../../web/lib/database-fetch";

describe("truthful dashboard reads", () => {
  it("distinguishes absent aggregate evidence from actual zero counts", () => {
    expect(embeddedCount(undefined)).toBeNull(); expect(embeddedCount([{ count: 14 }])).toBe(14);
    expect(embeddedCount([])).toBe(0); expect(embeddedCount([{ count: 0 }])).toBe(0);
    expect(embeddedCount([{ count: "14" }])).toBeNull(); expect(embeddedCount([{ count: -1 }])).toBeNull();
  });
  it("only displays safe links already present in stored events", () => {
    expect(storedClickUrl({ click: { link: "https://example.com/news" } })).toBe("https://example.com/news");
    expect(storedClickUrl({ url: "https://example.com/" })).toBe("https://example.com/");
    for (const value of [null, {}, { url: "javascript:alert(1)" }, { url: "https://user:password@example.com" }, { url: "https://example.com/" + "x".repeat(2100) }]) expect(storedClickUrl(value)).toBeNull();
  });
  it("retries read-only HEAD count queries, but not writes", async () => {
    const transport = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error("temporary network fault")).mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", transport);
    try { expect((await databaseFetch("https://mock.example/count", { method: "HEAD" })).status).toBe(200); expect(transport).toHaveBeenCalledTimes(2); }
    finally { vi.unstubAllGlobals(); }
  });
});
