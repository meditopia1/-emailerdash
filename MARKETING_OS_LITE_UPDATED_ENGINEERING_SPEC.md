# MARKETING OS LITE — UPDATED PHASE 1 ENGINEERING SPECIFICATION

**Document type:** Implementation requirements only — **not application code**  
**Version:** 1.0  
**Date:** 21 November 2026  
**Priority:** Smallest usable email-sending dashboard, operational as soon as possible.

> This document supersedes the previous multi-company, multi-role Phase 1 scope. Build **one admin login and one authenticated dashboard** first. Multi-company workspaces and advanced features are future phases.

---

## 1. Project goal

Build a private email marketing operations dashboard for a single administrator. The administrator can:

1. Configure a Resend sending connection and an authorized sender/domain.
2. Import permitted email contacts from CSV, or enter recipients manually.
3. Write and preview personalized HTML or plain-text emails.
4. Send test emails, then launch real campaigns.
5. Monitor what is queued, currently sending, sent, and failed.
6. See campaign-level and recipient-level delivery, open, click, bounce, complaint, and unsubscribe events.
7. View useful analytics without leaving the dashboard.

**Definition of success:** A real campaign can be composed, sent to an approved small recipient group, monitored during sending, and inspected per recipient after provider events arrive.

## 2. Simplified product model

| Area | Phase 1 decision |
|---|---|
| User accounts | Exactly one administrator login |
| Roles and permissions | No role system in Phase 1 |
| Login | Fixed admin username and password; **secrets configured server-side**, never committed into source |
| Registration | None |
| Onboarding | None |
| Companies/workspaces | No workspace switching or company creation |
| Resend | One active Resend connection |
| Sending domain | One active verified sending domain and sender identity at a time |
| Campaigns | Create, test, send now, view history |
| Contacts | CSV import and manual recipients, consent/suppression tracking |
| Scheduling | Not in Phase 1 |
| Follow-up automation | Not in Phase 1 |
| Analytics | Basic accurate delivery and engagement reporting |
| Main UI | One authenticated dashboard with tabs/sections |

**Future compatibility:** Organize business logic so multiple company workspaces, additional Resend connections, roles, and sender identities can be added later. Do not build their interfaces or authorization model now.

**Important distinction:** The administrator's login email/username has no relationship to the sender address shown to recipients. Emails are sent from the configured, verified Resend domain, not the admin's personal login account.

## 3. Pages and dashboard sections

### Page A — `/login`

Only separate application page besides the main dashboard.

**Functionality**
- Admin username field.
- Password field.
- Sign-in and logout.
- Server-validated credentials.
- Secure HttpOnly session cookie; `Secure` in production; SameSite protection.
- Invalid-login message that does not leak account details.
- Login rate-limiting at the application/edge level.
- Redirect unauthenticated requests to `/login`.
- No sign-up, forgot-password email flow, invitations, roles, or PIN-based login in Phase 1.

**Credentials rule:** A single fixed username and a strong password are supplied through server environment variables. “Hardcoded login” means one preconfigured account, **not** username/password literals embedded in frontend or committed source files. Prefer a password hash or secure server-side comparison; never print secrets in logs.

### Page B — `/` (single authenticated dashboard)

Use a left sidebar or compact top navigation **within the same dashboard**, containing the sections below. Do not create a separate routed page for every section in Phase 1.

#### B1. Overview

**Metric cards:**
- Total campaigns.
- Queued recipients.
- Currently processing recipients.
- Resend accepted.
- Delivered.
- Unique recipients who opened.
- Unique recipients who clicked.
- Failed/bounced/complained.
- Unsubscribed/suppressed.

**Visualizations:**
- Daily performance chart with 7-day / 30-day filters (90 days optional if trivial).
- Campaign-status distribution.
- Recent campaigns with current status and progress.

**Behavior:**
- Refresh active send status automatically approximately every 5–15 seconds while a campaign is running; less often when idle.
- Show last updated time.
- Clearly separate *provider accepted* from *inbox delivered*.
- Never fake analytics. Empty datasets show useful empty states.

#### B2. Compose & Send

**Fields:**
- Internal campaign name.
- Sender display name (default from Email Setup).
- From address (must belong to verified sending domain).
- Reply-To address.
- Subject.
- Optional preview/preheader text.
- Email content: HTML or plain text.
- Recipient input: manual entry or imported contacts/CSV.
- Recipient name where available.
- Personalization: `{{name}}`, `{{email}}` initially.

**Actions:**
- Preview rendered email.
- Preview representative personalized email.
- Save draft.
- Send test email to explicitly entered test address; label the subject `[TEST]`.
- Show recipient count and validation summary.
- Send Now with explicit confirmation.

**Validation:**
- Sender domain must be configured and authorized.
- Subject and body required.
- Reject malformed emails; normalize whitespace/case; deduplicate per campaign.
- Check suppression and marketing consent before queuing and again before actual dispatch.
- Do not send to synthetic/test domains during a real campaign.
- Reject empty audiences; enforce a configurable conservative per-campaign recipient cap.
- Include sender identification, physical mailing address, and functioning unsubscribe for marketing campaigns.

#### B3. Active Sending

**Functionality:**
- List queued and currently sending campaigns.
- Show per-campaign counts: total, remaining, processing, accepted, failed, blocked.
- Progress bar and continuously updated timestamp.
- Show latest worker activity and nonsecret error summaries.
- Allow stopping **remaining unsent recipients**.
- A campaign should continue sending after the admin logs out or closes the tab.

**Status terminology:**
- `draft` — not queued.
- `queued` — waiting to process.
- `sending` — processing in progress.
- `completed` — processing finished (does not imply every email delivered).
- `partially_failed` — some failed/blocked.
- `failed` — no accepted sends or fatal error.
- `cancelled` — remaining sends stopped.

**Reliability:**
- Persistent queue stored in PostgreSQL, not only in React state or a browser session.
- Background worker or authenticated scheduled handler processes bounded batches.
- Retry explicitly transient errors with bounded backoff.
- Prevent double sends with database reservation/locking and idempotency.
- When provider outcome is unknown after a network interruption, flag for review rather than automatically risking a duplicate.

#### B4. Campaign History

**Functionality:**
- Search campaigns by name.
- Filter by status and created date.
- Sort newest first by default.
- Display created date, audience size, accepted, delivered, unique opened, unique clicked, failed, and status.
- Open a campaign detail drawer/panel without leaving the dashboard.
- See all recipients and their latest statuses.
- Inspect campaign-level delivery/engagement breakdown.
- Allow duplicate-as-draft (optional if low effort).

**Do not** delete audit history by default after sends.

#### B5. Recipient Activity

**Functionality:**
- Search by recipient email and filter by campaign and event/status.
- See recipient email, name, campaign, provider message ID, latest status, and timestamps.
- Show events: accepted/sent/delivered/opened/clicked/bounced/complained/failed/suppressed/unsubscribed as provided by Resend.
- Display individual activity timeline and click events/URLs where available.
- Show errors without exposing credentials or raw secrets.

**Reporting caveat:** Open events are estimates; inbox clients may block or prefetch tracking pixels. Click events may also be affected by automated scanners. Show both recipient-unique metrics and raw event counts when useful.

#### B6. Contacts

**Functionality:**
- Add a contact manually.
- Import CSV file with email column; optional name column.
- Display import preview, invalid rows, duplicates, and final accepted count.
- Store consent status/source and import timestamp.
- Search contacts.
- Remove/suppress a contact.
- Prevent suppressed contacts from entering new or already queued sends.

**MVP policy:** Import only consented recipients. The admin must confirm permission to email, and the source of consent should be recorded. Do not implement scraping, purchased-list imports, or unsolicited cold outreach.

#### B7. Email Setup

**Functionality:**
- Configure Resend sending API key securely (never expose full value after save).
- Configure sender display name and From address.
- Configure verified domain (display and validation/check instructions).
- Configure Reply-To address.
- Configure company name and physical mailing address for email footer.
- Configure webhook signing secret securely.
- Show connection status and masked credentials.
- Send a safe test email.
- Show whether webhook events were received recently.

**Resend setup flow:**
1. Create or use an existing Resend account/team.
2. Verify the company's sending domain using Resend-provided DNS records.
3. Enable open/click tracking for the domain if engagement analytics are wanted.
4. Generate a sending-only/domain-restricted Resend API key if supported by the account configuration.
5. Enter API key and sender identity in Email Setup.
6. Create a webhook in Resend targeting the public HTTPS webhook URL.
7. Save the corresponding signing secret securely in the app.
8. Send test email, then a small opted-in real campaign.

**Separation note:** Domain verification happens through Resend and the DNS provider; entering a domain string in the dashboard does not itself verify it.

## 4. Other required endpoints (not extra dashboard pages)

- **Public unsubscribe landing:** a minimal `/unsubscribe` flow using a tamper-resistant token. Updates suppression state immediately.
- **Resend webhook:** server endpoint for signed provider events; signature validation and duplicate-event protection required.
- **Sending processor:** protected server endpoint or worker, triggered by scheduler independent of the browser.
- **Admin APIs:** all internal actions protected by the single admin session.

## 5. Initial technology stack

| Layer | Decision |
|---|---|
| Frontend/application | Next.js App Router, React, TypeScript |
| Styling | Tailwind CSS + shadcn/ui + Lucide icons |
| Database | Supabase-hosted PostgreSQL (isolated from Day1Main) |
| Data access | Server-side database queries with parameterization and minimal columns |
| Auth | One server-configured admin account + secure session cookie |
| Email provider | Resend Send Email API |
| Tracking | Resend signed webhooks |
| Charts | Recharts |
| Hosting | Vercel or another HTTPS-capable Node host |
| Background processing | PostgreSQL-backed queue + secure cron/worker |
| Validation | Zod / server-side input validation |

**Not required today:** Supabase Auth users, client-facing RLS membership hierarchy, Redis, Prisma, Elasticsearch, CRM pipeline, multi-company management, passkeys, subscription billing, or SEO.

## 6. Minimal database model

Aim for **six primary application tables** rather than the earlier 21/34/42-table designs.

| Table | Purpose | Primary relationships |
|---|---|---|
| `mail_settings` | One app configuration: sender, reply-to, mailing address, encrypted provider credentials, timestamps | Single active configuration record |
| `mail_contacts` | Approved recipient contact list, name, email, consent evidence | Referenced by recipient snapshots when applicable |
| `mail_suppressions` | Unsubscribes, complaints, hard bounces, manual exclusions | Unique normalized email, reason, source, timestamp |
| `mail_campaigns` | Draft/sending/completed campaigns, message content, counters and status | Parent of `mail_recipients` |
| `mail_recipients` | Final per-campaign send queue and recipient snapshots, provider ID, statuses/timestamps/errors | FK to `mail_campaigns`; optional FK to `mail_contacts` |
| `mail_events` | Immutable provider webhook and internal sending/audit events | FK to campaign and recipient where resolved |

**Relationship diagram:**

- `mail_campaigns` **1 → many** `mail_recipients`.
- `mail_contacts` **1 → many** `mail_recipients` (nullable for manual/CSV snapshots).
- `mail_recipients` **1 → many** `mail_events`.
- `mail_suppressions` applies globally by normalized email, regardless of campaign.
- `mail_settings` supplies the single active Resend configuration; campaign records should snapshot sender identity at send time.

**Querying/indexes:**
- Unique normalized contact email.
- Unique suppression email.
- Campaign created date and status.
- Recipients by campaign ID/status, email, and provider message ID.
- Events by provider event ID, recipient ID, and occurrence time.
- Unique provider event identifier to deduplicate webhook deliveries.
- Indexed queue claim fields for sending worker.
- Paginate contact, campaign, and activity tables; never return all rows to the browser.

**RLS and database permissions:**
- Admin UI accesses the database only through authenticated server routes.
- Never expose the service-role key in client code.
- Revoke/deny direct `anon` and `authenticated` access to private app tables; enable RLS on exposed tables.
- Use trusted server credentials for processing; require admin session or worker authorization at every API boundary.
- Webhook processing authenticates via signature, not admin cookie.

## 7. Resend event and analytics rules

**Event categories:**
- Accepted: Resend accepted the send API request.
- Delivered: Resend reports a delivery event.
- Opened: Resend reports recipient opened tracking event.
- Clicked: Resend reports tracked link click event.
- Bounced: delivery failure reported by provider.
- Complained: recipient reported spam.
- Failed: provider rejected or failed processing.
- Suppressed/unsubscribed: must block future sends.

**Counting rules:**
- Distinguish **total event count** from **unique recipients**.
- Delivered rate = unique delivered recipients ÷ accepted recipients.
- Unique open rate = unique opened recipients ÷ delivered recipients, when delivered data available; label denominator in UI.
- Unique click rate = unique clicked recipients ÷ delivered recipients, when delivered data available; label denominator in UI.
- Do not treat accepted as delivered.
- Preserve event timestamps and original source event IDs for traceability.
- Open/click data only updates after tracking is enabled and webhooks arrive.
- Analytics cover campaigns **sent through this app**; do not imply historical Resend account campaigns are automatically imported.

## 8. Security and sending safeguards

**Required before production sending:**
- Use HTTPS.
- Credentials in server environment variables or encrypted server-side settings; never plaintext in frontend bundle or logs.
- Strong one-admin password, secure session handling, anti-brute-force controls.
- Verified company-controlled Resend domain.
- Only permitted contacts with adequate consent evidence.
- Working unsubscribe link and sender/company information in marketing email.
- Suppression checks before queueing **and** dispatch.
- Signed webhook verification, timestamp tolerance, event deduplication.
- Queue idempotency and bound batch sizes.
- Failed event visibility and operational logging.
- Secrets and signing-token rotation plan.
- Explicit confirmation before a real send.

**Scope note:** A sender address such as `marketing@day1health.co.za` is independent of login credentials. One Resend connection/verified domain is the Phase 1 active sender. Multiple company brands and their separate credentials return in Phase 2.

## 9. Proposed dashboard layout

**Desktop:**
- Left: narrow navigation sidebar with **Overview, Compose, Sending, Campaigns, Activity, Contacts, Email Setup**.
- Top: application title, Resend connection status, current sending indicator, admin menu.
- Main: selected section's data table/chart/form.
- Right-side drawer: campaign or recipient details when opened.

**Mobile:**
- Collapsible sidebar.
- Responsive overview cards and stacked forms.
- Horizontally scrollable data tables or compact row cards.
- No cut-off actions or hidden send confirmation.

**Styling:**
- Minimal, professional SaaS UI similar in design principles to Resend/Linear.
- Dark theme first with optional light theme if trivial.
- Clear tables, typography and small purposeful animations; no SEO or public marketing website.

## 10. Exact Phase 1 build order

1. Initialize Next.js project and minimal dashboard layout.
2. Implement one fixed admin login and protected sessions.
3. Create isolated PostgreSQL project, six tables, indexes, and permissions.
4. Build Email Setup and Resend test-send verification.
5. Build Contacts import/validation/consent controls.
6. Build Compose, preview, draft, test-send and Send Now.
7. Add persistent queue, rate-limited processing, retries and cancellation.
8. Add Resend signed webhooks, delivery status and suppression updates.
9. Build Campaign History, Recipient Activity and Overview metrics.
10. Add secure unsubscribe flow and end-to-end tests.
11. Deploy to HTTPS, configure cron and provider webhook, run a small live test.

## 11. Phase 1 acceptance tests

The app is **not complete** until all applicable tests pass:

- [ ] Admin can log in; anonymous dashboard and API requests are denied.
- [ ] Password, Resend API key, webhook secret and database service key are not exposed in UI or logs.
- [ ] Verified sender and API key can send a test email.
- [ ] CSV import identifies malformed/duplicate emails and records consent source.
- [ ] A draft can be previewed, saved, and later sent.
- [ ] Recipient personalization does not expose unintended template data or unsafe HTML.
- [ ] Real send presents an explicit final confirmation.
- [ ] Queue continues processing when browser is closed.
- [ ] Progress updates show remaining, accepted, failed and blocked recipients.
- [ ] Provider acceptance is not mislabeled as delivered.
- [ ] Signed, deduplicated Resend webhooks update delivery/open/click status.
- [ ] A recipient's event timeline is viewable.
- [ ] Campaign overview chart and counters agree with recipient/event records.
- [ ] Unsubscribe works and immediately blocks queued/future sends.
- [ ] Hard bounce and complaint trigger suppression.
- [ ] Bad webhook signatures are rejected.
- [ ] Duplicate worker invocations do not send the same recipient twice.
- [ ] An interrupted/ambiguous provider send cannot be silently retried into a duplicate.
- [ ] Application is usable on desktop and mobile.

## 12. Explicitly postponed to Phase 2

Do **not** build any of these for the first release:

- Multi-company workspaces (Day1Health/MyMentor/Kervox switching).
- Five roles, role provisioning, employee invitations and onboarding.
- Username-based multi-user authentication or passkeys.
- Multiple Resend connections and domain management per company.
- Team settings and permission matrices.
- Automated drip sequences, follow-ups or scheduling.
- Prospect CRM and sales pipeline.
- AI content generation, lead scoring or A/B testing.
- Advanced template libraries/editors.
- Public landing pages and SEO.
- Billing, subscription tiers, and usage-based plans.
- Automatic DNS provisioning.

## 13. Instructions to the implementation AI

**Implement only this updated document.** Do not use the earlier full Marketing OS specifications as the current Phase 1 scope. Use them only as context for extensibility.

Prioritize real sending, accurate tracking and operational safety over page count or decorative features. Keep the UI one dashboard. Do not invent analytics, fake sends, or simulated delivery statuses as if they were real. Clearly report any untested integrations or setup tasks that require credentials, DNS access, a running worker, or a public deployment.

**Deliverable for the future implementation step:** A deployed, functioning private single-admin email dashboard, with working Resend sends, signed webhook analytics, and per-recipient history.
