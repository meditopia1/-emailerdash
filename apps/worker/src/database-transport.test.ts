import { expect, it, vi } from "vitest";
import { databaseFetch, databaseTransport } from "../../web/lib/database-fetch";

it("retries a failed read once, without retrying a mutation", async () => {
  try {
    const read = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error("temporary network failure")).mockResolvedValueOnce(new Response("[]", { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", read);
    const result = await databaseFetch("https://mock-database.example.com/contacts"); expect(await result.json()).toEqual([]); expect(read).toHaveBeenCalledTimes(2);
    const write = vi.fn<typeof fetch>().mockRejectedValue(new Error("temporary network failure")); vi.stubGlobal("fetch", write);
    await expect(databaseFetch(new Request("https://mock-database.example.com/contacts", { method: "POST", body: "{}" }))).rejects.toThrow("temporary network failure");
    expect(write).toHaveBeenCalledTimes(1);
  } finally { vi.unstubAllGlobals(); }
});

it("retries read-only HEAD counts within the same bounded read budget", async () => {
  try {
    const read = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 503 })).mockResolvedValueOnce(new Response(null, { headers: { "content-range": "0-0/5" } }));
    vi.stubGlobal("fetch", read);
    const deadline = vi.spyOn(AbortSignal, "timeout");
    const result = await databaseFetch("https://mock-database.example.com/contacts", { method: "HEAD" });
    expect(result.headers.get("content-range")).toBe("0-0/5");
    expect(read).toHaveBeenCalledTimes(2); expect(deadline).toHaveBeenNthCalledWith(1, 4500); expect(deadline).toHaveBeenNthCalledWith(2, 4500);
  } finally { vi.restoreAllMocks(); vi.unstubAllGlobals(); }
});

it("allows the audience write budget without retrying mutations", async () => {
  try { const deadline = vi.spyOn(AbortSignal, "timeout"); const write = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}")); vi.stubGlobal("fetch", write); await databaseTransport(25000)("https://mock-database.example.com/rpc/contact", { method: "POST" }); expect(deadline).toHaveBeenCalledWith(25000); expect(write).toHaveBeenCalledTimes(1); }
  finally { vi.restoreAllMocks(); vi.unstubAllGlobals(); }
});
