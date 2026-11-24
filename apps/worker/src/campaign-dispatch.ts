import postgres, { type Sql } from "postgres";
import { createHmac } from "node:crypto";
import { decryptSecret } from "../../web/lib/crypto.js";

type DispatchJob = {
  id: string; campaign_id: string; contact_id: string | null; email: string; name: string | null;
  sender_name: string; from_email: string; reply_to: string | null; subject: string;
  preheader: string | null; content_html: string | null; content_text: string | null;
  attempts: number; eligible: boolean; suppressed: boolean; send_delay_ms: number;
};

export function unsubscribeToken(email: string, secret: string) {
  return createHmac("sha256", secret).update(email.trim().toLowerCase()).digest("base64url");
}

function unsubscribeUrl(email: string, env: Record<string, string | undefined>) {
  const base = (env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
  const secret = env.ADMIN_SESSION_SECRET;
  return secret ? `${base}/api/unsubscribe?email=${encodeURIComponent(email)}&token=${unsubscribeToken(email, secret)}` : null;
}

async function sendEmail(job: DispatchJob, apiKey: string, env: Record<string, string | undefined>) {
  const url = unsubscribeUrl(job.email, env);
  const footer = url ? `\n\nTo unsubscribe from future emails: ${url}` : "";
  const body = {
    from: `${job.sender_name} <${job.from_email}>`, to: [job.email], subject: job.subject,
    ...(job.reply_to ? { reply_to: [job.reply_to] } : {}),
    ...(job.content_html ? { html: `${job.content_html}${url ? `<p><a href="${url}">Unsubscribe</a></p>` : ""}` } : { text: `${job.content_text || ""}${footer}` }),
    ...(url ? { headers: { "List-Unsubscribe": `<${url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } } : {}),
  };
  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", { method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10000), headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": `marketing-os-campaign/${job.campaign_id}/${job.id}` }, body: JSON.stringify(body) });
  } catch (error) {
    const cause = error && typeof error === "object" && "cause" in error ? (error as { cause?: { code?: string; message?: string } }).cause : null;
    const detail = error instanceof Error ? `${error.name}: ${error.message}${cause?.code ? ` [${cause.code}]` : ""}${cause?.message ? ` ${cause.message}` : ""}` : "Unknown network error";
    throw Object.assign(new Error(`Resend could not be reached (${detail.slice(0, 200)})`), { retryable: true });
  }
  const payload = await response.json().catch(() => null) as { id?: string; message?: string; name?: string } | null;
  if (!response.ok || !payload?.id) {
    const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
    const providerReason = [payload?.name, payload?.message].filter(Boolean).join(": ").replace(/[\r\n]+/g, " ").slice(0, 300);
    throw Object.assign(new Error(`Resend rejected the campaign message (${response.status}${providerReason ? `: ${providerReason}` : ""})`), { retryable });
  }
  return payload.id;
}

async function claim(sql: Sql, size: number): Promise<DispatchJob[]> {
  const result = await sql.begin(async tx => {
    const claimed = await tx`
      with candidates as (
        select r.id from public.mail_recipients r
        where r.status='queued' and (r.next_attempt_at is null or r.next_attempt_at<=now())
        order by r.id for update skip locked limit ${Math.max(1, Math.min(size, 100))}
      )
      update public.mail_recipients r set status='processing', reserved_at=now(), claimed_at=now(), last_attempt_at=now(), attempts=attempts+1
      from candidates where r.id=candidates.id returning r.id`;
    if (!claimed.length) return [];
    const ids = claimed.map(row => row.id);
    const jobs = await tx`
      select r.id,r.campaign_id,r.contact_id,r.email,r.name,r.attempts,
        c.sender_name,c.from_email,c.reply_to,c.subject,c.preheader,c.content_html,c.content_text,c.send_delay_ms,
        coalesce(a.eligible,false) as eligible,
        exists(select 1 from public.mail_suppressions s where s.normalized_email=lower(trim(r.email))) as suppressed
      from public.mail_recipients r join public.mail_campaigns c on c.id=r.campaign_id
      left join public.mail_contact_audience a on a.id=r.contact_id
      where r.id=any(${ids}::uuid[])`;
    return jobs;
  });
  return result as unknown as DispatchJob[];
}

async function settings(sql: Sql, env: Record<string, string | undefined>) {
  const [row] = await sql<{ resend_api_key_ciphertext: string | null; connection_disabled: boolean; connection_state: string; environment_credential_fingerprint: string | null }[]>`select resend_api_key_ciphertext,connection_disabled,connection_state,environment_credential_fingerprint from public.mail_settings where id=true`;
  if (!row || row.connection_disabled || row.connection_state !== "connection_validated") return null;
  // Local/deployed environment credentials are the operator's active key.
  // Fall back to the encrypted database credential when no environment key exists.
  if (env.RESEND_API_KEY) return env.RESEND_API_KEY;
  if (row.resend_api_key_ciphertext) {
    if (!env.ENCRYPTION_MASTER_KEY) throw new Error("Encryption master key is not configured");
    return decryptSecret(row.resend_api_key_ciphertext, env.ENCRYPTION_MASTER_KEY);
  }
  return null;
}

export async function runCampaignWorker(databaseUrl: string, signal: AbortSignal, env: Record<string, string | undefined> = process.env) {
  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 15, onnotice: () => {} });
  const concurrency = Math.max(1, Math.min(Number(env.WORKER_CONCURRENCY || 5), 20));
  try {
    while (!signal.aborted) {
      let jobs: DispatchJob[] = [];
      try { jobs = await claim(sql, concurrency); }
      catch (error) { console.error(JSON.stringify({ service: "campaign-worker", error: "Queue unavailable", code: (error as { code?: string }).code ?? null })); }
      if (jobs.length) {
        let apiKey: string | null = null;
        try { apiKey = await settings(sql, env); } catch { /* Each job receives a safe failure below. */ }
        const processJob = async (job: DispatchJob) => {
          const finish = async (result: "accepted" | "failed" | "blocked" | "retry", providerId: string | null, message: string | null, retryAt: Date | null) => { await sql`select public.mail_record_dispatch_result(${job.id},${result},${providerId},${message},${retryAt})`; };
          if (!job.eligible || job.suppressed) return finish("blocked", null, job.suppressed ? "Address suppressed after queueing" : "Recipient is no longer eligible", null);
          if (!apiKey) return finish("failed", null, "Resend connection is not validated", null);
          if (env.EMAIL_DRY_RUN === "true") return finish("failed", null, "Dry run is enabled; set EMAIL_DRY_RUN=false before launching real campaigns", null);
          try { const providerId = await sendEmail(job, apiKey, env); await finish("accepted", providerId, null, null); console.log(JSON.stringify({ service: "campaign-worker", campaign: job.campaign_id, recipient: job.id, status: "accepted" })); }
          catch (error) {
            const retryable = Boolean((error as { retryable?: boolean }).retryable) && job.attempts < 4;
            if (retryable) return finish("retry", null, "Temporary Resend failure; retry scheduled", new Date(Date.now() + Math.min(60000, 1000 * 2 ** Math.max(0, job.attempts - 1))));
            const message = error instanceof Error ? error.message : "Resend rejected this message or the retry limit was reached";
            return finish("failed", null, message.slice(0, 500), null);
          }
        };
        const groups = new Map<string, DispatchJob[]>();
        for (const job of jobs) groups.set(job.campaign_id, [...(groups.get(job.campaign_id) ?? []), job]);
        await Promise.all([...groups.values()].map(async campaignJobs => {
          for (const [index, job] of campaignJobs.entries()) {
            if (index > 0 && job.send_delay_ms > 0) await new Promise<void>(resolve => setTimeout(resolve, job.send_delay_ms));
            if (!signal.aborted) await processJob(job);
          }
        }));
        continue;
      }
      await new Promise<void>(resolve => { const timer = setTimeout(resolve, 1500); signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true }); });
    }
  } finally { await sql.end({ timeout: 5 }); }
}
