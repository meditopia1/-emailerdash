import { runImportWorker } from "./import-jobs.js";
import { runCampaignWorker } from "./campaign-dispatch.js";

type WorkerConfig = { concurrency: number; dryRun: boolean };

export function workerConfig(env: Record<string, string | undefined> = {}) : WorkerConfig {
  return { concurrency: Number(env.WORKER_CONCURRENCY ?? 5), dryRun: env.EMAIL_DRY_RUN === "true" };
}

export function retryDelay(attempt: number) { return Math.min(60_000, 1_000 * 2 ** Math.max(0, attempt - 1)); }

if (process.env.NODE_ENV !== "test") {
  void (async () => {
    const { readFileSync } = await import("node:fs"); const { parseEnv } = await import("node:util");
    const { resolve } = await import("node:path");
    let file: Record<string, string | undefined> = {}; try { file = parseEnv(readFileSync(resolve(__dirname, "../../../.env"), "utf8")); } catch { /* Deployment injects environment. */ }
    const env = { ...file, ...process.env }; const databaseUrl = env.WORKER_DATABASE_URL || env.DATABASE_URL;
    console.log(JSON.stringify({ service: "marketing-os-worker", status: "ready", ...workerConfig(env), campaignDispatch: "enabled" }));
    if (!databaseUrl) { console.error("Import worker requires WORKER_DATABASE_URL or DATABASE_URL"); process.exitCode = 1; return; }
    const controller = new AbortController(); process.once("SIGTERM", () => controller.abort()); process.once("SIGINT", () => controller.abort());
    await Promise.all([runImportWorker(databaseUrl, controller.signal), runCampaignWorker(databaseUrl, controller.signal, env)]);
  })().catch(() => { console.error("Import worker could not start"); process.exitCode = 1; });
}
