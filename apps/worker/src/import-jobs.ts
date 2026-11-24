import postgres from "postgres";
export async function runImportWorker(databaseUrl: string, signal: AbortSignal) {
  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 15 });
  try {
    while (!signal.aborted) {
      try {
        const [row] = await sql`select public.mail_process_import_batch(null,100) as result`;
        if (row.result) { console.log(JSON.stringify({ service: "audience-import-worker", job: row.result.id, retry: row.result.retry ?? false })); continue; }
      } catch (error) { console.error(JSON.stringify({ service: "audience-import-worker", error: "Storage unavailable", code: (error as { code?: string }).code ?? null })); }
      await new Promise<void>(resolve => { if (signal.aborted) return resolve(); const timer = setTimeout(done, 2000); function done() { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); } signal.addEventListener("abort", done, { once: true }); });
    }
  } finally { await sql.end({ timeout: 5 }); }
}
