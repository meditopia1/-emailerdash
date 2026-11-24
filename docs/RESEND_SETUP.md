# Resend connection, domains and tracking

## What changed

The existing Settings → Email setup now contains Resend Connection, Sending Domains, Your Sending Identity, and Tracking & Testing. Existing appearance settings, sidebar, campaign editor, draft APIs, encrypted settings storage, recipient records, event timeline and suppressions are reused. No duplicate campaign database or sending queue was created.

Campaign launch uses a durable recipient queue and worker. It still requires a validated Resend connection, verified sender, approved audience, and `EMAIL_DRY_RUN=false` in the worker environment.

## Database

Migration: [0006_resend_integration.sql](../supabase/migrations/0006_resend_integration.sql), after existing 0003, 0004 and 0005. It is additive and repeatable. Do not rerun removed multi-company migrations or reset the database.

```powershell
node scripts/apply-resend-integration.mjs
```

It extends `mail_settings` and `mail_recipients`; adds domain references, sender identities, explicit test results, credential-change audit and durable rate-limit storage. All new tables enable and force RLS, with no public/anon/authenticated table access. Restricted RPCs are executable only by the trusted service role. Existing campaign sender snapshots and content are not rewritten.

The migration has already been applied to the configured development database during implementation. Apply it separately to any different deployment database.

## Environment

No new secret variable names are introduced. Configure existing variables separately in Vercel and local `apps/web/.env.local` (the repository-root `.env` is used by database/worker scripts):

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_APP_URL` | `https://emailerdash.vercel.app` in production; generated webhook URLs use this origin. |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project's HTTPS URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only database access; never prefix with `NEXT_PUBLIC_`. |
| `ENCRYPTION_MASTER_KEY` | Server-only AES-256-GCM master secret, kept outside PostgreSQL. |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`, `ADMIN_SESSION_SECRET` | Existing single-admin authentication. |
| `DATABASE_URL` | PostgreSQL connection for migrations and database checks, not the Supabase HTTPS URL. |
| `RESEND_API_KEY` | Optional initial server-side sending key. An explicitly saved encrypted database key takes priority. Disconnect prevents environment fallback. |
| `RESEND_WEBHOOK_SIGNING_SECRET` | Optional initial `whsec_…` signing secret. An explicitly saved encrypted database secret takes priority. |
| `EMAIL_DRY_RUN` | Existing worker configuration. Explicit test-email confirmation authorizes one real test independently; saving settings never sends. |

`RESEND_FROM_EMAIL` is not used as a production fallback. `onboarding@resend.dev` appears only as an explicitly selected test option. Keep `.env` files ignored. Never rotate the encryption master key without first decrypting and re-encrypting stored credentials using a controlled server-side migration; losing it makes ciphertext unreadable. API-key replacement does not require changing the master key.

## Sending Access: recommended initial setup

1. Open [Resend Domains](https://resend.com/domains). Add the exact sending domain/subdomain you control. Follow Resend's verification instructions.
2. In [Resend API Keys](https://resend.com/api-keys), create a **Sending Access** key restricted to that exact domain where possible. Do not enter your Resend account password.
3. Open Marketing OS → Settings → Email setup → Resend connection. Paste the key, leave managed domain setup unchecked, then Connect/Replace API key. Status is **Configuration saved**, not validated.
4. Under Sending domains, choose the manual existing-domain workflow. Enter the exact domain you verified. It remains **Self-reported; DNS not checked**, because a sending-only key cannot retrieve domain resources.
5. Under Your sending identity, select that domain. Enter display name, an exact matching From address, valid authorized Reply-To (a different domain is allowed), company and mailing address. Save the identity.
6. Click Make default sender and confirm. This supplies the default for **new** campaigns only. Existing drafts and sent history retain their snapshots. Changing the default domain alone does not silently change the default sender.
7. Click Send test email. Select the identity and a mailbox you control, confirm both checkboxes and the displayed sender/destination. Only this explicit action sends one message with a `[TEST]` subject.
8. A successful Resend response records the provider email ID and validates sending access for that exact identity/current key. **Accepted does not mean delivered** and never upgrades a manual domain to DNS-verified.

No provider domain-management request is made for normal sending-only setup. If the account has no custom domain yet, explicitly choose the Resend test sender in the test dialog and use a recipient permitted by Resend's testing restrictions. This does not validate any custom sender identity or authorize production campaigns.

## Optional Full Access domain setup

Only enable managed setup if you explicitly choose to provide a Full Access key. A UI checkbox does not change a key's actual provider permissions.

1. Connect/replace the key with managed setup checked, or explicitly save that management preference for an existing Full Access key.
2. Select Import domain from connected Resend account, Load provider domains, choose the domain, then Link domain. Pagination loads another provider page explicitly.
3. Alternatively choose Create domain in Resend, enter a domain and confirm the external creation. This creates a Resend resource but does not change DNS. If the request times out, inspect Resend and import the resource if it exists; do not blindly create another.
4. Expand Exact DNS records from Resend. Each host, type, value, priority and TTL shown comes from the actual provider response. Copy the host/value fields to your DNS provider.
5. Add only the required records at the indicated hosts. Do not replace website records, existing SPF indiscriminately, or root incoming-mail MX records. Ask the DNS administrator to merge conflicting SPF requirements correctly.
6. Wait for propagation; Request verification, then Refresh status. Only a provider response of `verified` is shown as verified. Parent-domain approval does not approve arbitrary subdomains.
7. Configure a matching sender and explicitly test it. Full Access domain verification and sender sending permission are separate evidence.

Removing a local domain requires confirmation, removes its local sender identities, and leaves campaigns unchanged. It **never** deletes a domain from Resend, edits registrar DNS or transfers domains between teams. Default sender configuration is cleared if its local domain is removed.

## Webhooks

Deploy the web application and set its production environment before configuring the endpoint. Resend must be able to reach a public HTTPS URL; localhost is not reachable from Resend.

1. Open [Resend Webhooks](https://resend.com/webhooks) → Add webhook.
2. Endpoint: `https://emailerdash.vercel.app/api/webhooks/resend/default`.
3. Select `email.sent`, `email.delivered`, `email.opened`, `email.clicked`, `email.bounced`, `email.complained`, `email.failed`, `email.delivery_delayed`, `email.suppressed`.
4. Copy the endpoint's actual signing secret (`whsec_…`) into Settings → Tracking & testing → Webhook signing secret, then confirm save. Alternatively provision `RESEND_WEBHOOK_SIGNING_SECRET` on the server when no database secret has been saved.
5. Explicitly send a test email and inspect its recorded provider ID. Delivery/engagement events can only attach to provider email IDs already recorded by this application. A generic Resend dashboard sample with an unrelated ID is deliberately not attached to a campaign.
6. Refresh webhook health. It reports actual verified, associated events and their receipt time, not guessed readiness or future delivery.

The existing dynamic endpoint is reused, with the single-admin connection ID `default`. Other connection IDs are rejected. Signatures use the original raw body, all three Svix headers and a five-minute timestamp tolerance. Stable `svix-id` values deduplicate retries. Unknown provider email IDs return a retryable response, covering send/persistence races without trusting payload campaign/recipient IDs. If the ID genuinely belongs to another application sharing this Resend account, its events cannot be imported by this endpoint; configure an appropriate separate endpoint/account to avoid unrelated retries.

Provider event persistence, recipient timestamps, suppression creation and campaign counters commit atomically. Accepted, delivered, opened and clicked are distinct. Repeated genuine opens/clicks remain in the timeline but recipient-unique counters do not increment twice. Permanent bounce events and complaints/suppressions add a local suppression; they never silently remove one. Delayed events cannot regress a delivered/opened/clicked state or unblock a suppression.

## Open/click tracking

Tracking belongs to the sending domain, not the campaign. With Sending Access, configure it in Resend Domains; the app labels unavailable evidence **Not confirmed**. With explicitly enabled Full Access, refresh the provider domain, then confirm Enable opens & clicks or Disable tracking. Displayed values are read back from Resend, not optimistic fake toggles. Open tracking is approximate because privacy proxies, image settings and automated scanners affect it.

## Rotation, failures and safe tests

- API-key replacement generates a new credential version. Previous identity tests and domain evidence are stale until revalidated/refreshed. Operational keys in environment files are not overwritten.
- Environment keys are fingerprinted server-side as well. Changing an environment key outside Settings cannot retain old validation evidence; the next explicit configuration/test action synchronizes its credential version. Fingerprints are never returned to the browser.
- Disconnect removes the stored active API key and disables environment fallback. Revoke the key separately in Resend if required. Old signed campaign events can still be processed.
- Invalid credentials, denied permissions, conflicts, provider limits and network failures return bounded, sanitized actionable messages. Raw provider response text and secrets are not logged or relayed.
- Sensitive mutations have durable database-backed rate limits; explicit tests are limited to five requests/minute.
- Test requests have UUID idempotency, a request fingerprint and provider idempotency keys. Duplicate accepted requests return the recorded acceptance. Unknown outcomes are labeled honestly; inspect Resend logs before explicitly requesting another test.
- Suppressed test destinations remain blocked. Explicit tests require operator mailbox authorization; test sending does not grant contact marketing consent.
- No real campaign or live test email is sent by the automated provider tests. Mock transport has no production API override or environment-based bypass.

## Files and checks

Local startup: use `pnpm dev`. The launcher enables Node's system certificate store when supported, preserving TLS verification on networks using Windows-trusted certificates. Restart an already-running development server once after this launcher change. Do not disable certificate verification.

Playwright starts its own server on port 3001 with `MARKETING_OS_E2E=1`, `.next-test` output and `tsconfig.e2e.json`. The regular development server uses `.next-dev`; production builds use `.next`. Do not launch a second raw `next dev` against the same output folder: it can replace another server's route manifests and cause API/static-file 404s.

`node --use-system-ca scripts/diagnose-dashboard.mjs` performs read-only connectivity checks without displaying credentials or record contents. Confirmed saves are displayed separately from status-refresh failures. An unconfirmed write timeout is never retried automatically; inspect the saved list first.

Implementation files (relative to the repository):

- `supabase/migrations/0006_resend_integration.sql`; `scripts/apply-resend-integration.mjs`, `verify-resend-integration.mjs`.
- `apps/web/lib/resend-provider.ts`, `resend-integration.ts`, `webhook.ts`, `crypto.ts`, `supabase-admin.ts`, `database-fetch.ts`.
- Existing `apps/web/app/api/dashboard/settings/route.ts`; new `settings/resend/route.ts` and `settings/resend/test/route.ts`.
- Existing `apps/web/app/api/dashboard/overview/route.ts`, `campaigns/route.ts`, `campaigns/[id]/route.ts`, and `app/api/webhooks/resend/[connectionId]/route.ts`.
- `apps/web/app/dashboard/email-setup.tsx`, `email-integration-types.ts`, `test-email-dialog.tsx`, existing `forms.tsx` and `types.ts`.
- Existing `apps/web/app/campaign-builder/draft-fields.tsx`, `campaign-composer.tsx`; `app/email-setup.css`, `dashboard.css`, `layout.tsx`.
- `apps/worker/src/resend-integration.test.ts`, `resend-database.test.ts`, `database-transport.test.ts`; new `tests/ui/resend-settings.spec.ts`, `resend-webhook.spec.ts`; existing builder/dashboard regression tests.
- `.env.example`, this guide and the pre-implementation audit. Existing populated `.env` files were not modified.

The existing Resend package had no operational sending integration to reuse. The single new provider adapter calls the supported fixed-host REST API with bounded timeouts; it does not introduce another queue or upgrade dependencies unnecessarily.

```powershell
pnpm test
pnpm typecheck
pnpm test:ui
pnpm build
node scripts/verify-resend-integration.mjs
```

Provider transport/signature/encryption tests use mocks. Database integration checks run inside a rolled-back transaction. HTTP webhook fixtures use unique IDs and delete only their own rows. Browser checks cover real sanitized reads, authorization, connection/domain/identity/test UI with mocked provider writes, light/dark/mobile screenshots and existing builder/dashboard regressions.

Screenshots are local, ignored artifacts: `artifacts/ui/email-setup-light.png`, `email-setup-dark.png`, `email-setup-mobile.png`. They show development settings, not a claim that production domains or webhooks have been configured.

Verified on 2026-11-21: 21 unit/database checks passed; all 20 browser/API regressions passed, followed by all six focused settings/webhook checks after the final transport extraction. Typechecking and the production build passed. The database check confirms 11 private mail tables with forced RLS and zero remaining fixture campaigns, contacts, domains, events, suppressions or settings. No live Resend emails or provider/DNS management operations were performed during verification.

## Remaining manual/release work

Verify ownership and DNS in your actual Resend account, choose its real API-key permissions, deploy to Vercel, configure the production endpoint/secret and explicitly request a live test in the UI. None of these external provider/DNS actions were performed by automated tests. Before production campaigns, run the worker with `EMAIL_DRY_RUN=false` and verify signed webhook events and unsubscribe handling.
