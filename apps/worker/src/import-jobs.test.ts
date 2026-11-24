import { afterEach, beforeEach, expect, it, vi } from "vitest";
const database = vi.hoisted(() => {
  const query = Object.assign(vi.fn(), { end: vi.fn() });
  return { query, connect: vi.fn(() => query) };
});
vi.mock("postgres", () => ({ default: database.connect }));
import { runImportWorker } from "./import-jobs";
beforeEach(() => { vi.clearAllMocks(); database.query.end.mockResolvedValue(undefined); });
afterEach(() => vi.restoreAllMocks());

it("processes bounded import batches and closes storage after shutdown", async () => {
  const controller = new AbortController();
  database.query.mockImplementationOnce(async () => { controller.abort(); return [{ result: { id: "fixture-import", retry: false } }]; });
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  await runImportWorker("fixture-only-url", controller.signal);
  expect(database.query).toHaveBeenCalledTimes(1);
  expect(database.query.mock.calls[0][0].join("")).toContain("mail_process_import_batch(null,100)");
  expect(database.query.end).toHaveBeenCalledWith({ timeout: 5 });
  expect(output).toHaveBeenCalledWith(expect.stringContaining('"job":"fixture-import"'));
});
it("stops cleanly when an empty queue is interrupted", async () => {
  const controller = new AbortController();
  database.query.mockImplementationOnce(async () => { controller.abort(); return [{ result: null }]; });
  await runImportWorker("fixture-only-url", controller.signal);
  expect(database.query.end).toHaveBeenCalledTimes(1);
});
it("reports storage failures without credentials and still shuts down", async () => {
  const controller = new AbortController();
  database.query.mockImplementationOnce(async () => { controller.abort(); throw Object.assign(new Error("private connection value"), { code: "08006" }); });
  const output = vi.spyOn(console, "error").mockImplementation(() => {});
  await runImportWorker("fixture-only-url", controller.signal);
  expect(output).toHaveBeenCalledWith(expect.stringContaining('"code":"08006"'));
  expect(output.mock.calls.flat().join(" ")).not.toContain("private connection value");
  expect(database.query.end).toHaveBeenCalledTimes(1);
});
