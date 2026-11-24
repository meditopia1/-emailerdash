import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ guard: vi.fn(), rpc: vi.fn(), definitions: vi.fn() }));
vi.mock("../campaign-api", () => ({ campaignApiGuard: mock.guard }));
vi.mock("../supabase-admin", () => ({ supabaseAdmin: () => ({ rpc: mock.rpc }) }));
vi.mock("../audience-server", () => ({ customDefinitions: mock.definitions, audienceCriteria: vi.fn(), audienceError: () => Response.json({ error: "Contact could not be saved" }, { status: 400 }) }));
import { POST } from "../../app/api/dashboard/contacts/route";
const request = (body: unknown) => new Request("http://localhost/api/dashboard/contacts", { method: "POST", body: JSON.stringify(body) }) as Parameters<typeof POST>[0];
beforeEach(() => { vi.resetAllMocks(); mock.guard.mockResolvedValue(null); mock.definitions.mockResolvedValue([]); mock.rpc.mockResolvedValue({ data: "test-id", error: null }); });
describe("contact creation contract (isolated storage, no remote traffic)", () => {
  it("authenticates before accessing storage", async () => {
    mock.guard.mockResolvedValue(Response.json({ error: "Unauthorized" }, { status: 401 }));
    expect((await POST(request({ email: "person@example.com", existing_opt_in: true }))).status).toBe(401); expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("routes explicit prior opt-in to the database-timed create-only function", async () => {
    const response = await POST(request({ email: "Person@Example.com", existing_opt_in: true }));
    expect(response.status).toBe(201); expect(await response.json()).toEqual({ id: "test-id" });
    expect(mock.rpc).toHaveBeenCalledExactlyOnceWith("mail_contact_add_opted_in", { payload: expect.objectContaining({ email: "person@example.com" }) });
    expect(mock.rpc.mock.calls[0][1].payload).not.toHaveProperty("existing_opt_in"); expect(mock.rpc.mock.calls[0][1].payload).not.toHaveProperty("consent");
  });
  it("preserves API and import defaults when no declaration is supplied", async () => {
    expect((await POST(request({ email: "person@example.com" }))).status).toBe(201);
    expect(mock.rpc.mock.calls[0][0]).toBe("mail_contact_save"); expect(mock.rpc.mock.calls[0][1].payload).not.toHaveProperty("consent");
  });
  it("rejects conflicting permission instructions before writing", async () => {
    expect((await POST(request({ email: "person@example.com", existing_opt_in: true, consent: { status: "revoked" } }))).status).toBe(400); expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("does not retry a rejected mutation", async () => {
    mock.rpc.mockResolvedValue({ data: null, error: { code: "23505" } });
    expect((await POST(request({ email: "person@example.com", existing_opt_in: true }))).status).toBe(400); expect(mock.rpc).toHaveBeenCalledTimes(1);
  });
});
