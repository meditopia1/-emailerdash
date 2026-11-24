import { z } from "zod";
import { selectionSchema } from "./audience-schema";

export const campaignColumns = "id,name,sender_name,from_email,reply_to,subject,preheader,content_html,content_text,status,total_count,accepted_count,delivered_count,opened_count,clicked_count,failed_count,blocked_count,send_delay_ms,created_at,started_at,completed_at,audience_contact_ids,audience_selection,revision,workflow_layout,layout_revision";
export const nodeIds = ["start", "audience", "email", "results"] as const;
const coordinate = z.number().finite().min(-10000).max(10000);
export const layoutSchema = z.object({
  version: z.literal(1),
  positions: z.object({ start: z.object({ x: coordinate, y: coordinate }), audience: z.object({ x: coordinate, y: coordinate }), email: z.object({ x: coordinate, y: coordinate }), results: z.object({ x: coordinate, y: coordinate }) }).strict(),
  viewport: z.object({ x: coordinate, y: coordinate, zoom: z.number().min(.2).max(2) }),
  selectedNode: z.enum(nodeIds),
}).strict();

export const draftSchema = z.object({
  name: z.string().trim().min(1).max(200),
  subject: z.string().trim().min(1).max(998),
  preheader: z.string().max(500).optional().default(""),
  content_text: z.string().max(500000).optional().default(""),
  content_html: z.string().max(500000).optional().default(""),
  content_format: z.enum(["text", "html"]).optional().default("text"),
  sender_name: z.string().trim().min(1).max(200).optional(),
  from_email: z.string().trim().toLowerCase().email().max(320).optional(),
  reply_to: z.union([z.string().trim().email().max(320), z.literal("")]).optional(),
  audience_contact_ids: z.array(z.string().uuid()).max(1000).optional().default([]),
  audience_selection: selectionSchema.optional().default({ type: "contacts" }),
  send_delay_ms: z.number().int().min(0).max(600000).optional().default(0),
}).strict().superRefine((value, context) => {
  if (!(value.content_format === "html" ? value.content_html : value.content_text).trim()) context.addIssue({ code: "custom", message: "Email content is required", path: ["content_text"] });
});

export function isUuid(value: string) { return z.string().uuid().safeParse(value).success; }
