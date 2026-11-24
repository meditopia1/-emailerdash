import { NextResponse } from "next/server";
import { z } from "zod";
import { campaignApiGuard } from "../../../../../lib/campaign-api";
import { audienceCriteria, audienceError, customDefinitions } from "../../../../../lib/audience-server";
import { supabaseAdmin } from "../../../../../lib/supabase-admin";
import { csvCell } from "../../../../../lib/contact-import";
const columns = ["name", "email", "first_name", "last_name", "phone", "company", "job_title", "lifecycle_status", "consent_status", "consent_source", "lead_source", "imported_at", "last_contacted_at", "last_opened_at", "last_clicked_at", "campaign_count", "eligible", "tags"];
export async function POST(request: Request) {
  const denied = await campaignApiGuard(request); if (denied) return denied;
  try {
    const body = z.object({ ids: z.array(z.string().uuid()).max(1000).optional(), query: z.string().max(20000).optional() }).strict().parse(await request.json()); const db = supabaseAdmin();
    const records: Record<string, unknown>[] = [];
    if (body.ids?.length) {
      for (let at = 0; at < body.ids.length; at += 100) {
        const ids = [...new Set(body.ids.slice(at, at + 100))];
        const [result, details] = await Promise.all([
          db.from("mail_contact_audience").select("id,name,email,first_name,last_name,phone,company,job_title,lifecycle_status,consent_status,consent_source,lead_source,imported_at,last_contacted_at,last_opened_at,last_clicked_at,campaign_count,eligible").in("id", ids).limit(100),
          db.from("mail_contacts").select("id,tag_links:mail_contact_tag_memberships(tag:mail_contact_tags(name)),custom_values:mail_contact_field_values(field_id,value)").in("id", ids).limit(100),
        ]);
        if (result.error || details.error) throw result.error ?? details.error;
        const metadata = new Map((details.data ?? []).map(row => [row.id, row]));
        records.push(...result.data.map(row => ({ ...row, tags: metadata.get(row.id)?.tag_links.map(link => (link.tag as unknown as { name: string }).name) ?? [], custom_fields: Object.fromEntries((metadata.get(row.id)?.custom_values ?? []).map(value => [value.field_id, value.value])) })));
      }
    } else { const criteria = audienceCriteria(new URLSearchParams(body.query)); const result = await db.rpc("mail_audience_query", { criteria }); if (result.error) throw result.error; records.push(...result.data.contacts); }
    const fields = await customDefinitions(); const headers = [...columns, ...fields.map(field => `custom.${field.key}`)];
    const csv = [headers.map(csvCell).join(","), ...records.map(row => [...columns.map(key => csvCell(row[key])), ...fields.map(field => csvCell((row.custom_fields as Record<string, unknown> | undefined)?.[field.id]))].join(","))].join("\r\n");
    return new NextResponse(`\uFEFF${csv}`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=contacts-export.csv", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return audienceError(error); }
}
