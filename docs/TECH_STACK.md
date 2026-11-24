# Marketing OS

Current implementation follows the Lite specification. Existing Next.js dashboard, HMAC administrator authentication, Supabase PostgreSQL, server-only RLS boundaries and Resend integration remain the base.

## Audience management

Apply migrations in order: `0003` through `0010`. Do not rerun the old multi-workspace foundation migrations. `0007_audience_management.sql` extends the existing contact table and adds private tags, fields, segments, static lists, import jobs, consent history and activity history. `0008_audience_approval.sql` adds recipient approvals without queueing emails. `0009_contact_profile_read.sql` and `0010_dashboard_read.sql` combine bounded profile/dashboard reads to reduce network timeouts. Existing IDs and campaign history are preserved.

For this configured workspace: `node --use-system-ca scripts/apply-audience-management.mjs`. The script checks whether the additive migrations are installed. Never reset the schema to upgrade.

Start the persistent import worker with `pnpm --filter worker dev`. It uses `WORKER_DATABASE_URL`, falling back to `DATABASE_URL`, and processes transactions of 100 rows. Run it on a persistent host, not a Vercel request. Imports remain queued if it is stopped; the UI also offers an explicit bounded “Process next 100” fallback. Restarts resume persisted progress. This worker does **not** dispatch campaigns.

Limits: 10 MB CSV, 100,000 rows/file, 100 columns, 200 rows/upload batch, 400 KB client upload chunks, 50 custom fields, 100 dynamic segments and 100 static lists. XLSX is not supported. Imports preview the first 100 rows and validate every row server-side. Existing-record imports update only mapped profile fields; existing consent, archived state, suppressions and engagement are never replaced. New consent is unknown unless original permission method, source, timestamp and evidence are explicitly supplied.

Contacts use server-side search, validated nested filter ASTs, stable pagination (25/50/100 rows), manual TanStack Table sorting/selection and device-local column preferences. Export is bounded to the current page or up to 1,000 selected contacts. CSV cells are escaped against spreadsheet formula injection. Import error reports are downloaded in pages of 1,000 rows.

The existing 1,000-contact campaign limit remains. Individual contacts, dynamic segments, static lists and ad-hoc filters can be previewed. Approval re-evaluates membership and permission, rejects stale previews, and stores an immutable recipient snapshot. Saving or approving never sends email; explicit launch creates the durable queue. The worker rechecks current suppression/consent per recipient, uses Resend idempotency keys, retries temporary provider failures, and never silently expands membership. Custom field personalization is supported in safe preview (`{{custom.field_key}}`).

Verification: `pnpm typecheck`, `pnpm build`, `pnpm --filter worker test`, `pnpm test:ui tests/ui/audience-management.spec.ts`, and `node --use-system-ca scripts/verify-audience-management.mjs`. The SQL verification uses a rollback-only transaction; browser tests clean up only their uniquely identified fixtures. Neither performs live email sends. Do not run SQL verification while the real worker is processing production imports: its outer fixture transaction intentionally holds locks until rollback.

Verified 2026-11-22: typecheck and production build passed; 71 unit/integration tests, 36 rollback-only audience/database checks and 45 browser regressions passed. Worker runtime module loading passed. Browser tests exercised real contact persistence, CSV mapping/conflicts, consent/suppression protection, profiles, custom fields, segments/lists, audience approval, authorization, error recovery, themes and mobile layouts. Test fixtures were removed; existing records were preserved. Desktop/mobile screenshots and the clean browser report are in `artifacts/ui/` (`audience-final-test-report.json`). No live emails were sent.

## Implementation map

- `apps/web/app/audience/`: contact table, configurable columns, multi-page selection, bulk actions, contact creation/editing/profile drawers, nested filters, resource editors and CSV import workflow. Existing typography, theme tokens, layout, form fields, skeletons and global toast system are reused.
- `apps/web/lib/audience-schema.ts`, `audience-server.ts`, `contact-import.ts`: shared strict schemas, safe query criteria, typed custom fields, CSV parsing/mapping and formula-safe exports.
- `apps/web/app/campaign-builder/`: existing visual/standard builder extended with audience sources, exact previews, explicit immutable approvals and custom-field personalization. Existing Resend sender validation and test-send flow remain intact.
- `apps/worker/src/import-jobs.ts`: persistent transactional import processing. Existing administrator authentication, server-only Supabase client and private-table RLS pattern are retained.
- `scripts/apply-audience-management.mjs`, `verify-audience-management.mjs`: additive installation and rollback-only integration checks.

## Audience API

All paths below are under `/api/dashboard/contacts`, require the existing administrator session, and reject cross-origin writes. Responses are uncached. Browser database roles have no direct table or RPC access.

| Path | Methods | Purpose |
| --- | --- | --- |
| `/` | GET, POST | Bounded search/filter/sort/pagination; create contact; existing-contact resolver |
| `/[id]` | GET, PATCH | Bounded profile timelines and atomic contact updates |
| `/resources` | GET, POST, DELETE | Dynamic segments, static lists and custom-field definitions |
| `/bulk` | POST | Tags, list membership, archive/restore and manual suppression |
| `/export` | POST | Current-page or selected-contact CSV |
| `/imports` | GET, POST | Recent jobs; preview, idempotent create/stage, start, resume, process and cancel |
| `/imports/[id]/errors` | GET | Paged CSV validation/error report |
| `/audience` | POST | Exact campaign audience preview and explicit snapshot approval |
