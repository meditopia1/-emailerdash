import { describe, expect, it } from "vitest";
import { retryDelay, workerConfig } from "./index";

describe("worker safeguards", () => {
  it("uses bounded exponential retry delay", () => { expect(retryDelay(1)).toBe(1000); expect(retryDelay(8)).toBe(60000); });
  it("reads dry run and concurrency settings", () => { expect(workerConfig({ WORKER_CONCURRENCY: "3", EMAIL_DRY_RUN: "true" })).toEqual({ concurrency: 3, dryRun: true }); });
});
