import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const web = spawn(process.execPath, [fileURLToPath(new URL("./dev-web.mjs", import.meta.url))], { cwd: root, stdio: "inherit", windowsHide: true });
const worker = spawn(process.execPath, [fileURLToPath(new URL("./worker-runner.mjs", import.meta.url))], { cwd: root, stdio: "inherit", windowsHide: true });
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  web.kill("SIGTERM");
  worker.kill("SIGTERM");
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, stop);
web.on("exit", code => { if (!stopping) stop(); process.exitCode = code ?? 1; });
worker.on("exit", code => { if (!stopping && code) console.error(`Campaign worker stopped (${code}). Restart pnpm dev to resume queue processing.`); });
