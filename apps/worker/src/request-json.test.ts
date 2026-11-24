import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, requestJson } from "../../web/app/dashboard/types";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe("dashboard request failures", () => {
  it("keeps write timeouts explicit and never repeats an uncertain save", async () => {
    const controller = new AbortController(); controller.abort(new DOMException("signal timed out", "TimeoutError"));
    const deadline = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    const transport = vi.fn<typeof fetch>().mockRejectedValue(controller.signal.reason); vi.stubGlobal("fetch", transport);
    await expect(requestJson("/settings", { method: "PUT", body: "{}" })).rejects.toThrow("It may have completed");
    expect(deadline).toHaveBeenCalledWith(30000); expect(transport).toHaveBeenCalledTimes(1);
  });
  it("gives refresh guidance for read timeouts", async () => {
    const controller = new AbortController(); controller.abort(new DOMException("signal timed out", "TimeoutError"));
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(controller.signal.reason));
    await expect(requestJson("/overview")).rejects.toThrow("Loading took too long");
  });
  it("preserves deliberate cancellation when changing views", async () => {
    const controller = new AbortController(); controller.abort();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(controller.signal.reason));
    await expect(requestJson("/overview", { signal: controller.signal })).rejects.toBe(controller.signal.reason);
  });
  it("does not show raw JSON errors when a restarting server returns HTML", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>Not found</html>", { status: 404 })));
    await expect(requestJson("/settings", { method: "PUT" })).rejects.toThrow("change may already have completed");
  });
  it("preserves server field guidance", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Choose a matching domain", field_errors: { from_email: "Use support@example.com" } }), { status: 400 })));
    const failure = await requestJson("/settings", { method: "PUT" }).catch(error => error);
    expect(failure).toBeInstanceOf(ApiRequestError);
    if (!(failure instanceof ApiRequestError)) throw new Error("Expected actionable API error");
    expect(failure.fieldErrors.from_email).toBe("Use support@example.com");
  });
});
