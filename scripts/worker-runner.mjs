import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const workerRoot = fileURLToPath(new URL("../apps/worker/", import.meta.url));
const require = createRequire(new URL("../apps/worker/package.json", import.meta.url));
const tsxCli = require.resolve("tsx/cli");
const preloader = "../../scripts/node-os-compat.cjs";
const flags = process.allowedNodeEnvironmentFlags.has("--use-system-ca") ? ["--use-system-ca"] : [];
const nodeOptions = [process.env.NODE_OPTIONS, ...flags, `--require=${preloader}`].filter(Boolean).join(" ");
const child = spawn(process.execPath, [...flags, "--require", preloader, tsxCli, "src/index.ts"], { cwd: workerRoot, env: { ...process.env, NODE_OPTIONS: nodeOptions }, stdio: "inherit", windowsHide: true });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("error", () => { console.error("Could not start the campaign worker."); process.exitCode = 1; });
child.on("exit", code => { process.exitCode = code ?? 1; });
