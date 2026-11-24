# Visual campaign builder: integration audit

## Existing implementation

The Lite dashboard is a single authenticated `/` route. `dashboard-shell.tsx` selects sections; `dashboard/forms.tsx` contains the existing composer, plain-text preview, contacts form, and sender settings. The visual builder belongs inside **Compose & Send**, with an action from the existing campaign list.

| Area | Existing source | Reuse and limitations |
| --- | --- | --- |
| Campaign drafts | `app/api/dashboard/campaigns/route.ts` | Extend this POST operation; add detail GET and version-checked draft PATCH operations under the same campaign resource. |
| Campaign identity and counters | `mail_campaigns` | Keep the same IDs, fields, status enum, sender snapshots, content, and analytics counters. |
| Recipients | `mail_recipients`, linked by `campaign_id` | Read existing recipient records in Monitor Mode. Do not create queued recipients when saving a draft. |
| Contacts and consent | `mail_contacts` | Select existing consented contacts. CSV uploads resolve against existing contacts; missing or suppressed addresses remain excluded. |
| Normalization and eligibility | `packages/email/src/index.ts` | Reuse `normalizeEmail` and `isEligibleRecipient` server-side. |
| Suppression | `mail_suppressions` | Validate selection on the server; display excluded and missing contacts. |
| Sender setup | `mail_settings`, existing settings API | Reuse the configured From address. Credentials remain encrypted and server-only. |
| Composer | Existing `Compose` fields and plain-text preview | Extract controlled fields and preview into shared components used by both modes. Preserve name, subject, preheader, body, sender editing, preview, and Save Draft. |
| Templates | No template API or table in Lite | Do not invent a template backend. Explain that the saved campaign content is used. |
| Sending/test sends | Resend test-send API and campaign dispatch | Keep explicit test sends separate from campaign launch. Launch requires validated sender and approved audience. |
| Queue | Durable recipient queue and campaign worker | Claim with row locks, recheck eligibility, send idempotently, retry transient failures, and update campaign counters. |
| Tracking | `mail_events`, campaign counters, overview API | Read canonical data. The webhook endpoint only checks a custom HMAC and logs payloads; it does not persist events and does not implement the full Resend signature protocol. Do not represent this as production-ready tracking. |
| Authentication | Admin HttpOnly session cookie and middleware | Preserve this boundary; add explicit session checks and same-origin checks to builder API writes. |
| Themes | Existing light/dark and accent preferences | Support both canvas themes; default to dark when no explicit appearance preference exists. |

## Integration decisions

- One controlled draft state backs Standard Editor and Visual Builder. Mode switches never reconstruct fields from a stale saved row.
- The four nodes have fixed semantic edges: Start → Audience → Email → Results. Dragging and zooming have no sending side effects. Nodes/edges cannot be added, removed, or reconnected.
- Keep a new unsaved draft mounted while navigating dashboard sections. Show the unsaved state and require an explicit choice before replacing it with another campaign.
- Extend `mail_campaigns` with draft contact IDs, canonical revision, workflow layout JSON, and a separate layout revision. A backwards-compatible migration preserves current records and RLS.
- Draft audience selection is not a queue. No recipient enters `mail_recipients` until a future validated sending operation explicitly creates its recipient snapshots.
- Content saves and layout saves use separate optimistic revision checks. A stale save returns HTTP 409 and retains local edits. Layout writes never update content, recipients, counters, or status.
- Existing rows receive default node positions. Save only positions, viewport, selected node, and editor view metadata in the layout field; never serialize executable connections or secrets.
- Non-draft campaigns open read-only Monitor Mode; layout changes remain allowed. Poll detail data only while status is `queued` or `sending`, and stop on completion or unmount.
- Use existing campaign counters and recipient/event records. Missing metrics are labelled unavailable; accepted and delivered remain separate.

## Verification

Browser checks cover mode synchronization, layout dragging/persistence, node inspectors, previews, theme support, mobile fallback, Monitor Mode, and fixed connections. API checks cover authentication, malformed input, draft saves, optimistic conflicts, independent layout saves, and suppression/consent eligibility. Test-created records are identified by unique IDs and removed without deleting existing user records. Real emails are not sent.

React Flow integration follows its [custom node documentation](https://reactflow.dev/learn/customization/custom-nodes), [controlled canvas reference](https://reactflow.dev/api-reference/react-flow), and [save/restore example](https://reactflow.dev/examples/interaction/save-and-restore).

## Local verification commands

- `pnpm typecheck` — check web, worker, and shared packages.
- `pnpm build` — production compilation.
- `pnpm test` — existing worker tests.
- `pnpm test:ui` — browser and API integration tests, including mode synchronization, authenticated saves, revision conflicts, HTML preview isolation, CSV validation, mobile layout, theme persistence, polling shutdown, and retry states. Requires local `.env.local`, `DATABASE_URL`, and Chrome. The test fixture removes only its own uniquely named simulation records.
- `node scripts/verify-campaign-builder.mjs` — read-only verification of all four builder columns, forced RLS on all six private tables, and no remaining simulation records.

`0005_campaign_visual_builder.sql` has been applied to the configured development database. Existing campaign IDs and records are preserved. Deployment to another database requires applying that migration after `0003` and `0004`; the migration is additive and repeatable.

Screenshots are saved to ignored `artifacts/ui/campaign-builder-*.png`. Browser checks do not launch campaigns or send real emails. Live sending requires `EMAIL_DRY_RUN=false` in the worker environment.
