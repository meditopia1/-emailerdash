import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const webRoot = fileURLToPath(new URL("../apps/web/", import.meta.url));
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
// Trust the operating system's CA store without disabling TLS verification.
const flags = process.allowedNodeEnvironmentFlags.has("--use-system-ca") ? ["--use-system-ca"] : [];
const child = spawn(process.execPath, [...flags, require.resolve("next/dist/bin/next"), "dev", ...process.argv.slice(2)], { cwd: webRoot, stdio: "inherit", windowsHide: true });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("error", () => { console.error("Could not start the web server. Check Node.js and installed dependencies."); process.exitCode = 1; });
child.on("exit", code => { process.exitCode = code ?? 1; });
