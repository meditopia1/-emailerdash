# Marketing OS — AI Engineering & Product Specification

**Document type:** Build specification / source of truth for the coding AI  
**Version:** 1.0  
**Date:** 2026-11-21  
**Status:** Product requirements confirmed; implementation not started by this document  
**Companion file:** `MARKETING_OS_TECH_STACK.md` (technology and infrastructure details)

> **AI ENGINEERING DIRECTIVE:** Build a private, production-conscious, multi-company marketing platform. Follow the fixed terminology, roles, workspace isolation, invitation flow, email provider boundaries and permission matrix in this document. Do not reinterpret “provision roles” as shared logins. Do not build insurance-specific member onboarding into this application. Ask only when a decision is truly blocking; otherwise follow the specified defaults.

---

## 1. Product definition

**Marketing OS** is one central web application used by independent companies to manage targeted, permission-based email marketing and sales outreach. Example tenants:

- **Day1Health** — uses its own workspace, people, sender domain(s), templates and campaigns.
- **MyMentor** — separate workspace and email infrastructure.
- **Kervox** — separate workspace and email infrastructure.
- **AltiraOrbit** — another potential workspace; no special handling required.

Each company should feel like it owns a private marketing dashboard. Platform operators can manage all companies; normal company users can access only the companies they are assigned to.

**Primary use cases**

1. Platform Super Admin creates a company and automatically provisions its four fixed company roles and initial account invitations.
2. Invited staff activate their own secure user accounts and complete short personal onboarding.
3. Company Admin connects a Resend account/team via restricted API credentials, verifies a sending domain and approves sender identities.
4. Company users maintain prospects, opt-in contacts, organizations, consent records and segments.
5. Authorized managers compose, preview, test and send targeted campaigns to eligible recipients.
6. Signed Resend events update recipient-level and company-level analytics.
7. Staff manage follow-up tasks, sales opportunities and suppressions without crossing company boundaries.

**Explicitly NOT this product:** a consumer website, public registration portal, search-engine-optimized marketing site, insurance member portal, policy onboarding system, generic transactional notification service or unsolicited cold email blaster.

### Core product qualities

- Fast, clean, data-dense desktop-first UI; works on mobile.
- One codebase, one auth system and one shared database with hard multi-tenant isolation.
- One separate persistent worker for email delivery jobs.
- Per-company sending identity, credentials, webhooks and data.
- Individual user appearance preferences and role-aware Settings.
- Strong authorization, audited actions, operational resilience and clear error states.

---

## 2. Canonical terminology — use these exact meanings

| Term | Canonical meaning |
|---|---|
| **Platform** | Entire Marketing OS product and shared infrastructure. |
| **Super Admin** | The single platform-level role with full authorized administration across workspaces. |
| **Workspace / Company Workspace** | Isolated environment representing one company. Company and workspace are interchangeable only when talking about the tenant, not a prospect company. |
| **Organization / Prospect Company** | A business being marketed to inside a workspace's CRM. **Not** a workspace. |
| **System Role** | One of exactly five hardcoded role identifiers, defined in source code. |
| **Workspace Role** | One of the four fixed non-platform system roles that is available automatically in every workspace. |
| **User Account** | One real person's identity, unique username, password/passkey credentials and recovery email. No shared role logins. |
| **Workspace Membership** | User-to-workspace association with exactly one workspace role. A person may have memberships in multiple workspaces. |
| **Role Slot** | The four fixed role definitions made available to every workspace; role slots are not user accounts. |
| **Initial Role Invite** | The first invitation sent for each of the four company roles during company provisioning. |
| **Invitation Email** | Person's valid personal/work email used for activation, recovery and notification. May be Gmail, Outlook, etc. |
| **Login Username** | Globally unique handle entered at login; need not match a company's brand or the person's email. |
| **Sending Domain** | Domain or subdomain verified and authorized within a Resend connection. |
| **Sender Identity** | Approved From name/address (and Reply-To) belonging to a workspace's verified sending domain. |
| **Resend Connection** | Server-side encrypted credentials, configuration and webhook verification for one provider account/team or scoped key. |
| **Campaign** | Company-scoped email delivery project, with defined recipients, content, settings and lifecycle. |
| **Recipient** | Snapshot of an intended individual email destination for a campaign. |
| **Suppression** | Rule blocking a contact/email from eligible outbound sends (unsubscribed, complained, hard bounced, etc.). |

**Important correction:** Every workspace automatically gets **four role definitions**, and we also create **four initial user invitations** (one for each role). This does not mean that a role is a shared credential or that a workspace may only have four people. Later, many individual accounts may hold the same role.

---

## 3. Fixed role model — exactly five roles

Use these constants; do not build a role builder or editable permission designer.

```ts
export const SYSTEM_ROLES = {
  SUPER_ADMIN: 'super_admin',
  COMPANY_ADMIN: 'company_admin',
  MARKETING_MANAGER: 'marketing_manager',
  MARKETING_AGENT: 'marketing_agent',
  VIEWER: 'viewer',
} as const;

export const WORKSPACE_ROLES = [
  SYSTEM_ROLES.COMPANY_ADMIN,
  SYSTEM_ROLES.MARKETING_MANAGER,
  SYSTEM_ROLES.MARKETING_AGENT,
  SYSTEM_ROLES.VIEWER,
] as const;
```

### 3.1 Role descriptions

1. **Super Admin (platform):** creates companies, oversees platform accounts and all authorized workspaces, controls global security and configuration, resolves integration issues, can suspend company sending. Not one of the four company roles.
2. **Company Admin:** manages assigned workspace, company profile, brand, team membership/invitations, provider connections, domains, senders, company settings and campaigns.
3. **Marketing Manager:** creates, tests, approves and launches company campaigns; manages eligible audiences, templates, follow-ups, company reporting and marketing suppressions.
4. **Marketing Agent:** manages contacts and prospect organizations, prepares campaign drafts/templates and manual follow-ups. **Cannot perform real campaign sending or manage secrets/domains/users.**
5. **Viewer:** reads permitted dashboards, lists, performance, activity and reports. Cannot alter business data or send.

### 3.2 Permission matrix

**Legend:** Y = allowed; — = denied; * = within own workspace only.

| Action | Super Admin | Company Admin | Marketing Manager | Marketing Agent | Viewer |
|---|:---:|:---:|:---:|:---:|:---:|
| Create/suspend/archive workspaces | Y | — | — | — | — |
| Access all workspaces | Y | — | — | — | — |
| Manage workspace members and invitations | Y | Y* | — | — | — |
| Change fixed role definitions/permissions | — | — | — | — | — |
| Assign/reassign fixed workspace role to users | Y | Y* | — | — | — |
| Connect/revoke Resend credentials | Y | Y* | — | — | — |
| Manage verified sending domains and identities | Y | Y* | — | — | — |
| Edit company branding, campaign defaults and limits | Y | Y* | — | — | — |
| View workspace dashboard | Y | Y* | Y* | Y* | Y* |
| Create/edit contacts, organizations and segments | Y | Y* | Y* | Y* | — |
| View CRM and campaign lists | Y | Y* | Y* | Y* | Y* |
| Create/edit drafts and templates | Y | Y* | Y* | Y* | — |
| Send test email to verified test recipient | Y | Y* | Y* | Y* | — |
| Run safe validation / dry-run simulation | Y | Y* | Y* | Y* | — |
| Launch/resume real campaigns | Y | Y* | Y* | — | — |
| Cancel active campaign | Y | Y* | Y* | — | — |
| Manage suppression rules (audited) | Y | Y* | Y* | — | — |
| Manage manual follow-up tasks | Y | Y* | Y* | Y* | — |
| Edit sales pipeline / lead status | Y | Y* | Y* | Y* | — |
| View analytics, send activity and audit history* | Y | Y* | Y* | Y* | Y* |
| Edit own profile, theme and preferences | Y | Y | Y | Y | Y |
| Change another user's login password | — | — | — | — | — |

*Audit visibility for non-admin roles may show only non-sensitive marketing activity; secrets and private security audit details remain hidden. **No role can directly view stored full provider keys or user passwords after creation.**

**Role invariants**

- Role catalog and permissions are **immutable from the UI**, with hardcoded authorization on the server and/or database.
- Membership assignments **can** be added, disabled, transferred or changed to one of the four fixed company roles by an authorized admin.
- Super Admin authority is platform-level, never assigned through ordinary workspace invitations or an editable company role.
- Super Admin can inspect all tenants via strongly audited privileged functions. Ordinary users never get unrestricted service-role access.
- One user account may belong to many workspaces, with a different workspace role in each.
- One membership has exactly one role per workspace in MVP. No custom roles, combinations or temporary privilege escalations.

---

## 4. Account creation, invites and initial onboarding

### 4.1 Super Admin creates company

**Route:** `/admin/companies/new` (plus details at `/admin/companies/[id]`).

**Required inputs**

- Workspace display name (e.g. Day1Health).
- Globally unique workspace slug (`day1health`).
- Optional website, logo, description, industry, business timezone.
- **Four initial invite email addresses:** one for Company Admin, one for Marketing Manager, one for Marketing Agent, one for Viewer. These can be personal email addresses, not necessarily professional domains. Validate all four; require distinct recipient identities at initial setup.
- Optional initial sender display name; Resend connection setup happens later.

**Provisioning transaction**

1. Check `super_admin` permission and server-side validation.
2. Create the workspace with state `setup_pending`.
3. Seed/confirm the four **immutable available workspace roles** (if using global role constants rather than rows, store the immutable roster as code and do not duplicate definitions needlessly).
4. Create four invitation records, one per role; never create shared login credentials.
5. Enqueue four invitation emails using the **platform's own transactional invitation sender**, not the newly created company's unverified sending domain.
6. Log actor, timestamps, workspace ID and invite attempt statuses.
7. Return a workspace overview displaying four roles and invite statuses (`pending`, `sent`, `accepted`, `expired`, `revoked`, `delivery_failed`).

Do not send external emails *inside* the database transaction: commit first, then deliver via an outbox/job so failed mail does not silently lose the invitations. Support idempotent retry/resend.

**Workspace exists even if an invitation email fails.** Mark its setup incomplete; allow Super Admin to fix address and resend. Activation is always tied to current, unexpired, single-use invite.

### 4.2 Invitation email

Contains company name, assigned role, recipient email, secure one-time activation link, expiry and support contact. **Never include passwords, numeric login PINs, full API keys or shared credentials.**

Use safe signed/opaque token handling with one-time redemption, stored hashed token or trusted Auth invite mechanism, expiration and revocation. Rate limit invitation and redemption attempts.

### 4.3 First activation + onboarding

**Routes:** `/invite/accept` and `/onboarding`.

1. Verify invitation (valid, not expired, not already redeemed or revoked, workspace active).
2. For a new person, create/activate their Supabase Auth identity with a verified invitation email. Existing person: confirm ownership and attach new membership to existing identity; do not create duplicate accounts.
3. Suggest a globally unique login username; person can confirm/change it during activation.
4. New person chooses their own strong login password; Auth stores it, not app tables. Existing users keep existing password.
5. Collect display name, optional avatar and personal preferences: theme, accent, compact/comfortable/spacious density, timezone, notification settings.
6. Offer optional account recovery setup, and require relevant consent to platform terms/privacy policy.
7. Mark onboarding completed; activate membership; record audit event.
8. Redirect to that company's overview, or to workspace selector if more than one assigned workspace.

**Onboarding is required once per user account.** On later invitations, show a short “Join workspace” confirmation instead of repeating password setup or full personalization.

**Account lifecycle:** `invited → accepted → onboarding → active`; related operational states: `expired`, `revoked`, `suspended`. Avoid multiple conflicting state flags.

### 4.4 Login UX — no company-branded email required

**Route:** `/login`.

- **MVP:** globally unique username + password.
- Email used for invitations, recovery and notifications only; email is **not** displayed as the professional sending identity.
- Password verified against Supabase Auth. Resolve username server-side to the linked auth account; never expose the lookup email, credential checks, service keys or different error messages for unknown username vs wrong password.
- Rate limit per account/IP, log suspicious activity without sensitive credentials, and set secure HTTP-only session cookies.
- Forgot password via verified recovery email; changes revoke/refresh sessions as appropriate.
- **Future:** device passkey (WebAuthn) login; device PIN/biometrics can unlock the passkey. **Do not implement weak website PIN-only authentication.**
- **No open public sign-up.** All user account access derives from a controlled invitation.

**Three distinct identities**

```text
Login username:          theo                (unique app username)
Invitation/recovery:     theodt.bmm@gmail.com (private human identity)
Marketing sender:        marketing@updates.day1health.co.za (workspace-approved From)
```

These must remain separate in the schema, UI and API.

### 4.5 Later employee management

Company Admin can invite extra staff and choose one of the **four fixed** company roles. Admin can suspend, revoke an invitation, resend, reassign membership role and remove workspace membership. Must not delete the fixed role slots. Prevent accidental removal of the last active Company Admin without controlled Super Admin recovery. Removal of a workspace membership does not delete the user's identity or memberships in other workspaces.

---

## 5. Company-specific Resend connections and domains

### 5.1 Ownership model

```text
Marketing OS Platform
  ├── Workspace: Day1Health
  │     └── Resend connection(s) → verified domain(s) → sender identity(ies)
  ├── Workspace: MyMentor
  │     └── Resend connection(s) → verified domain(s) → sender identity(ies)
  ├── Workspace: Kervox
  │     └── Resend connection(s) → verified domain(s) → sender identity(ies)
  └── Workspace: AltiraOrbit
        └── Resend connection(s) → verified domain(s) → sender identity(ies)
```

The company owns its own sending configuration. A workspace may have multiple verified sending domains, and each domain may have multiple approved sender identities. Within Marketing OS, bind a canonical sending domain to just one workspace. A provider connection must never be reused silently across unrelated companies.

### 5.2 Recommended Resend model

- Prefer distinct Resend teams/accounts for independent clients when practicable.
- Issue a **sending-only, domain-restricted API key** for the appropriate workspace/domain. Use multiple connections if multiple scoped domains need separate keys.
- **Never request the client's Resend dashboard password.**
- Store keys and webhook signing secrets **encrypted at rest and server-only**; show only fingerprint and connection health, never plaintext values after save.
- Use an independent platform Resend credential/sending domain for **staff invitations and recovery**, separate from client campaign sending.
- An existing operational Day1Health domain should not be repurposed casually: a marketing subdomain (e.g. `updates.day1health.co.za`) can segregate campaign traffic.

### 5.3 Connection setup wizard

**Accessible to:** Super Admin and Company Admin.

1. Open **Settings → Email & Domains → Connect Resend**.
2. Enter a restricted Resend API key; validate server-side and save encrypted.
3. Register a sending domain under this connection (manually in Resend for MVP), or select an existing Resend-verified domain.
4. Display the required DNS instructions and record a domain verification status (`pending`, `verified`, `failed`, `disabled`). **Use actual Resend/DNS results, never claim verification from entered text alone.**
5. Create approved From name, From address and Reply-To address for that domain.
6. Configure a signed webhook endpoint and its secret, e.g. `/api/webhooks/resend/[connectionId]`. Record webhook health separately from domain status.
7. Send controlled test email to an explicitly entered test recipient.
8. Activate sending only after server checks pass.

**MVP constraint:** A sending-only key may be insufficient for provider-domain listing or full resource management. When read access is unavailable, let the administrator complete verification in the Resend dashboard and validate as far as allowed; do not store full-access keys merely to make the MVP wizard automatic. Explicitly distinguish `self-reported`, `provider-verified` and `test-send-passed` statuses.

### 5.4 Mandatory checks before every real send

The backend must verify **all** of:

- Authenticated operator can send from this workspace.
- Workspace, campaign, sender identity, domain and Resend connection IDs belong together.
- Connection is active and credentials are usable.
- Selected From domain is approved/verified, not merely typed.
- Suppression/consent eligibility and campaign confirmation pass.
- No ongoing duplicate job/send is claimed.
- Email job is queued with durable idempotency and correct workspace ownership.

Do not accept arbitrary `from` addresses or API keys submitted in a campaign POST payload. Select approved identities by ID; resolve server-side.

---

## 6. Dashboard design & themes

**Visual direction:** professional, lightweight, calm, data-dense SaaS UI; patterns from Linear/Attio/Resend/Stripe. No public SEO, no visual clutter or heavy animation.

**Global shell**

- Collapsible left sidebar: logo, workspace switcher, navigation, account menu.
- Persistent breadcrumb/page header and context actions.
- Responsive desktop, tablet and mobile layouts.
- Fast server-filtered tables, dense rows, optional column configuration, sticky headers and virtualized long lists.
- Command palette (`Ctrl/Cmd+K`) as progressive enhancement.
- Skeleton, empty, success, error and retry states throughout.
- Role/permission-aware navigation, but permission checks also enforced on server/database.

**Theme choices (per user, across all workspaces):** System, Light, Dark, Midnight, Graphite, Warm, High Contrast. Also configurable accent and density (`compact`, `comfortable`, `spacious`). Implement via Tailwind CSS variables, `next-themes`, accessible contrast and user preference persistence. Preview theme in Settings and apply without reloading.

**Do not build separate dashboard code for each role.** Build one component system, one route structure and a centrally defined permission matrix. Render relevant navigation, data and actions according to role.

---

## 7. Complete pages and expected functionality

### Route structure

All internal routes require authentication. `/admin/**` requires Super Admin. `/w/[slug]/**` requires active workspace membership (or audited Super Admin platform access).

| Page | Route | Core functionality | Access |
|---|---|---|---|
| Login | `/login` | Username/password, forgot-password flow, rate-limit feedback | Public entry |
| Invite acceptance | `/invite/accept` | Verify invite, accept workspace assignment, start onboarding | Valid invite |
| Onboarding | `/onboarding` | Username/password for new users, profile and theme setup | Activated identity |
| Workspace selector | `/workspaces` | List workspaces user can access; choose active workspace | Authenticated |
| Global platform dashboard | `/admin` | Cross-company counts, health, pending invites, send queue, warnings | Super Admin |
| All company workspaces | `/admin/companies` | Create/search/filter/suspend/archive workspaces | Super Admin |
| Create company | `/admin/companies/new` | Company wizard, four required initial role invite addresses | Super Admin |
| Company provisioning details | `/admin/companies/[id]` | Invite statuses, resend, company setup progress, company health | Super Admin |
| Platform user management | `/admin/users` | Account discovery, status, authorized membership oversight | Super Admin |
| Platform settings | `/admin/settings` | Global limits, security, integration health, policies, logs | Super Admin |
| Workspace overview | `/w/[slug]/overview` | Company-only metrics, activity, recent campaigns, quick tasks | All workspace roles |
| Contacts | `/w/[slug]/contacts` | Contacts table, add/edit/import, filters, dedupe, consent | Admin/Manager/Agent write; Viewer read |
| Contact detail | `/w/[slug]/contacts/[id]` | Profile, tags, consent evidence, activity, campaigns | All (write gated) |
| Prospect organizations | `/w/[slug]/organizations` | Business/lead company records, association to contacts | All (write gated) |
| Organization detail | `/w/[slug]/organizations/[id]` | Company notes, leads, linked contacts, opportunities | All (write gated) |
| Sales pipeline | `/w/[slug]/pipeline` | New → qualified → contacted → interested → demo → proposal → client | All (write gated) |
| Campaigns | `/w/[slug]/campaigns` | Counts, search, status/type filters, sorts, recent campaigns | All (write gated) |
| New campaign | `/w/[slug]/campaigns/new` | Full compose/recipients/template/test/dry-run/send workflow | Admin/Manager/Agent (send gated) |
| Campaign detail | `/w/[slug]/campaigns/[id]` | Status, recipients, events, errors, filters, audit, follow-up | All (actions gated) |
| Follow-ups | `/w/[slug]/follow-ups` | Manual nurture tasks, eligibility, due dates, statuses | All (write gated) |
| Templates | `/w/[slug]/templates` | Shared per-company templates, personalization, preview | All (write gated) |
| Activity | `/w/[slug]/activity` | Accepted/sent/delivered/opened/clicked/bounced/etc. | All |
| Analytics | `/w/[slug]/analytics` | Funnel metrics, segmentation, date ranges, conversion views | All |
| Suppressions | `/w/[slug]/suppressions` | Bounce/complaint/unsubscribe blocks, audited changes | Admin/Manager manage; others read per permission |
| Workspace settings | `/w/[slug]/settings` | Tabbed company settings based on permissions | All, tab-gated |
| Personal account settings | `/account/settings` | Own profile, security, appearance, notifications | All |
| Not found / no access | `/403`, `/404` | No information leakage about private resources | As needed |

### 7.1 Platform dashboard (`/admin`)

- Workspace totals, active/suspended states, company invitation activation rates.
- Cross-workspace campaign summaries and provider/queue health.
- Security events and operational warnings; audit filters.
- Super Admin shortcuts: Create company, Manage users, Review failures.
- No direct exposure of provider secrets.

### 7.2 Workspace overview (`/w/[slug]/overview`)

- Counts: campaigns (draft/queued/sending/sent/failed/cancelled), eligible contacts, organizations, follow-ups.
- Accepted, delivered, opened and clicked indicators, with accurate denominators.
- Time-series chart for 7/30/90 days; status distribution and recent campaigns.
- Upcoming manual follow-ups, bounce/complaint alerts, sender connection health.
- Auto-refresh selected live counts; avoid entire-page refresh and unnecessary polling.

### 7.3 Contacts (`/contacts` and `/contacts/[id]`)

- Server-side search, filters, sorting, cursor pagination and page size control.
- Create/edit, CSV import with field mapping, preview, deduplication and validation report.
- Fields: name, email, optional phone/title, linked organization, tags, owner, custom fields, source, consent status/evidence/timestamp, lead status.
- Contact activity tab: linked campaign sends/events, suppression flags, follow-up tasks.
- Import source row numbers and audit who imported/edited the data.
- A prospect can exist in CRM while being **ineligible for marketing email**.

### 7.4 Prospect organizations (`/organizations`)

- Business name, website, industry, location, size/range, contact associations, needs, notes, account owner and status.
- Separate “prospect organization” records from tenant workspace records by table names and UI wording.
- Search/dedupe companies; viewing an organization must not imply a workspace membership.

### 7.5 Sales pipeline (`/pipeline`)

- Columns: `new_lead`, `qualified`, `contacted`, `interested`, `demo_booked`, `proposal_sent`, `client_acquired` plus `lost`.
- Cards show organization/contact, owner, updated date, next task, optional estimated value.
- Stage changes audited; stage filters and optional list view for dense datasets.
- Email activity may enrich lead context, but **opens do not automatically imply qualified or interested**.

### 7.6 Campaign list (`/campaigns`)

- Search by title/description; filter by status, campaign type, source, date; sort newest/oldest/name.
- Statuses: `draft`, `queued`, `sending`, `sent`, `failed`, `cancelled`.
- Campaign types: Product Introduction, Demo Invitation, Case Study, Lead Nurturing, Follow-up, Announcement, Customer Communication, Reactivation.
- Actions: view, edit draft, duplicate, archive/delete draft with explicit confirmation, create eligible follow-up.
- Deleting historical sent campaign records must not silently destroy required audit/consent records. Prefer archive/soft delete for sent campaigns.

### 7.7 Campaign builder (`/campaigns/new`)

Step 1 **Details:** name, objective/type, optional description/tags.  
Step 2 **Sender:** approved verified sender identity, reply-to, company signature.  
Step 3 **Audience:** select individual opted-in contacts, saved segment, or validated CSV rows with documented permission.  
Step 4 **Content:** subject, preheader, CTA, HTML/text content, template, variable mapping, unsubscribe elements.  
Step 5 **Review:** resolved recipient count, missing variables, contact eligibility, exclusions, preview.  
Step 6 **Test and dry-run:** send test to chosen authorized test address; dry-run performs validation without mailing the real recipients; optional Resend sandbox routing is a distinct explicit action.  
Step 7 **Send now:** real send confirmation, durable queue submission, progress display.

**MVP scheduling:** do not expose a working scheduling action unless the queue scheduler actually implements it. If not implemented, say “Send now only” and omit scheduling controls.

**Recipient safeguards**

- Normalize email addresses, validate format, dedupe per campaign and retain source snapshots.
- Up to **1,000 recipients per campaign in MVP** (configurable and enforced in server and UI).
- Max provider batch size **100**, UI default **25**; throttle per connection/provider.
- Limit template variable names, count and content size; HTML escape variables by default. Only explicitly trusted HTML inputs may be unescaped.
- Avoid distributing secrets, passwords or personal member portal access credentials in marketing messages.
- Require verified opt-in/other valid provider-approved permission for sending, unsubscribe access and suppression checks; an operator checkbox alone is not proof of recipient permission.
- Resend accepted ≠ delivered. Never label provider acceptance “inbox delivered.”

### 7.8 Campaign detail (`/campaigns/[id]`)

- Campaign metadata and snapshot, sender, audience source, content summary, sent-by.
- Individual recipient status, provider ID, accepted/delivered/open/click/bounce/complaint timestamps, errors.
- Paginated activity table and search; safely filter by status.
- Retry eligible failed jobs when permitted; avoid resending accepted deliveries.
- Cancel pending unsent work; do not claim sent mail can be recalled.
- Create manual follow-up to **eligible** recipients; exclude replied/converted/unsubscribed/suppressed recipients, with manual reply flags until inbox sync exists.

### 7.9 Follow-ups (`/follow-ups`)

- List pending/due/completed/cancelled manual follow-up tasks; contact, campaign, owner, due date.
- Create follow-up campaign drafts from appropriate prior campaign audiences.
- Suggested default cadence: introduction Day 0, follow-ups Day 3 and Day 7, final Day 14, then stop. This is not an automatic scheduler in MVP.
- Stop on unsubscribe, complaint, hard bounce, recorded reply, booked demo or converted client.
- Do not infer reply from open/click tracking; reply detection requires future inbound integration.

### 7.10 Templates (`/templates`)

- Company-scoped template library: Product Intro, Demo Invitation, Case Study, Follow-up, Announcement, Customer Welcome.
- Editor, subject/preheader, preview, personalization, default footer/signature, duplication, version metadata, test email.
- For MVP templates live in our database; do not require broad Resend resource credentials.

### 7.11 Activity (`/activity`)

- Company-wide email event timeline: accepted, sent, delivered, opened, clicked, bounced, complained, failed, suppressed, unsubscribed.
- Include event timestamp, recipient, campaign, provider event ID, attempt number, relevant error details.
- Events from signed webhooks only; dedupe repeated deliveries, handle out-of-order messages safely.
- Search and filter server-side; never expose events from another tenant.

### 7.12 Analytics (`/analytics`)

- Metrics: accepted, sent, delivered, unique opens, unique clicks, fails, bounces, complaints, unsubscribes.
- Date/segment/campaign filters and line charts; use definitions with clear denominators.
- Sales attribution via separately recorded demo bookings and client acquisition events (not email clicks alone).
- Avoid claiming revenue/ROI unless actual tracked source data exists.
- Paginated/exportable aggregates; precomputed database summaries when needed.

### 7.13 Suppressions (`/suppressions`)

- Auto-record unsubscribe, complaints and permanent hard bounces from signed provider events.
- Manual suppression with reason and actor; audited lift when policy allows.
- Hard blocks are rechecked at final send time, including delayed/retried queue work.
- Build functional unsubscribe route/page; one-click unsub support as applicable, tenant-aware tokens and global/domain suppression policy as configured.
- Never allow an imported CSV or a new campaign to bypass existing suppression records.

---

## 8. Settings design by role

### 8.1 Two separate Settings locations

1. **Personal Settings** `/account/settings` — exists for **every** user, regardless of role or active workspace. Preferences belong to the user.
2. **Workspace Settings** `/w/[slug]/settings` — visible to workspace members, but business tabs/actions are authorized by their workspace role. Workspace settings belong to the company.

**Platform Settings** `/admin/settings` is **Super Admin only**.

### 8.2 Common Personal Settings for all five roles

- **Profile:** name, avatar, username (unique, protected change flow), recovery/invitation email and verification status.
- **Appearance:** System/Light/Dark/Midnight/Graphite/Warm/High Contrast, accent, density, sidebar collapse, preferred start page.
- **Preferences:** language, timezone, dates/numbers, table column presets and page size.
- **Notifications:** campaign updates and follow-up reminders allowed for the user's role.
- **Security:** password change, account recovery, MFA where supported, session/device controls; future passkey registration.
- **My Workspaces:** memberships, assigned role, last-used workspace; cannot self-grant privileges.

### 8.3 Super Admin — `/admin/settings`

- Platform general settings and operational defaults.
- All workspace status, suspend/restore and support tooling.
- Authorized platform admins and user directory oversight.
- Security policy, authentication/invitation rate limits, sessions.
- Email invitation provider, global sending caps, queue status and provider integration health.
- Audit event search and administrative activity reporting.
- Monitoring/health/read-only operational diagnostics; never plaintext secret displays.

### 8.4 Company Admin — workspace Settings

- **Company profile:** legal/display name, industry, website, logo, timezone.
- **Branding:** logo, sender display names, default footer/signatures, colour tokens used in branded templates.
- **Team:** invite, revoke/resend, suspend membership, assign one of four fixed roles. Cannot rename roles.
- **Email & Domains:** Resend restricted credentials, domain setup/verification, webhook status, test sending.
- **Senders:** verified identities, From addresses and Reply-To defaults.
- **Campaign defaults:** allowed cadence, send batch size, permission/consent controls, default templates.
- **Compliance:** unsubscribe policy, suppression visibility, consent rules.
- **Audit & Health:** company-only logs, provider errors, failure/retry status.

### 8.5 Marketing Manager — workspace Settings

- **Campaign defaults:** chosen approved sender, message type, template, segments and batch size within company limits.
- **Follow-up rules:** manual cadence defaults and task reminders.
- **Reporting:** default date ranges and saved report views.
- **Suppressions:** authorized create/review actions with audit and no secret access.
- **Templates:** shared template choices and default campaign footer content, within permissions.
- **No:** Resend keys, DNS/domain activation, user-role administration, global settings.

### 8.6 Marketing Agent — workspace Settings

- Draft editor preferences, default template, default contact columns/filters, task reminders.
- Personal dashboard layout and notification preferences.
- **No:** real-send approval, Resend key setup, user management, suppression overrides.

### 8.7 Viewer — workspace Settings

- Report date range, saved read-only views, table columns, display layout.
- Own personal settings.
- **No:** campaign/CRM changes, sending, secrets, team management.

**Security:** Tabs can be hidden/disabled for UX, but every API must enforce the same role rules. A guessed URL must not bypass authorization.

---

## 9. Architecture and implementation stack

**Keep compatible with the companion tech-stack file; do not arbitrarily swap frameworks.**

| Concern | Approved stack |
|---|---|
| Frontend/backend | Next.js App Router, React, TypeScript strict |
| Styling/UI | Tailwind CSS, shadcn/ui, Radix, Lucide |
| Themes | next-themes + CSS tokens |
| Queries/caching | TanStack Query |
| Tables | TanStack Table + TanStack Virtual |
| Forms | React Hook Form + Zod |
| Charts | Recharts |
| Database | Supabase PostgreSQL, SQL migrations, indexes, RLS |
| Identity | Supabase Auth (invite-only) |
| Email | Resend per-workspace restricted sending connection |
| Queues | PostgreSQL-backed pg-boss; separate always-on Node worker |
| Hosting | Vercel (web), Railway/Render/Fly.io (worker), managed Postgres/Auth |
| QA | Vitest + Playwright |
| Workspace packages | pnpm workspaces |

**Architecture shape:** modular monolith, web app + durable worker, shared typed packages, database first. No unnecessary microservices, Redis, Elasticsearch, Kafka, ORM migration or Kubernetes in MVP.

Recommended repository structure:

```text
marketing-os/
├── apps/
│   ├── web/                    # Next.js UI and secure server APIs
│   └── worker/                 # Persistent email and invitation jobs
├── packages/
│   ├── authz/                  # Immutable roles and permission checks
│   ├── email/                  # Resend adapter, signing, templates, safeguards
│   ├── schemas/                # Shared types and Zod schemas
│   └── ui/                     # Reusable theme-aware dashboard controls
├── supabase/
│   └── migrations/             # Schema, constraints, indexes and RLS
├── tests/
├── docs/
│   ├── AI_ENGINEERING_SPEC.md
│   └── TECH_STACK.md
├── .env.example
└── pnpm-workspace.yaml
```

---

## 10. Core data model

All company-owned business data has `workspace_id` and safe foreign-key relationships. All major records have `created_at`, `updated_at`, audit actor references and appropriate indexed query paths.

| Table | Function / important relationships |
|---|---|
| `profiles` | `user_id` (Auth FK), globally unique username, display name, private recovery email reference |
| `platform_admins` | Controlled list of Super Admin account IDs |
| `user_preferences` | `user_id`, theme, density, accent, timezone, notifications |
| `workspaces` | Company name, unique slug, status, branding, owner metadata |
| `workspace_memberships` | `(workspace_id, user_id)` unique, `role` fixed enum, status, joined_at |
| `workspace_invitations` | workspace, invited email, assigned fixed role, token/hash or Auth invite link, status, expiry, actor |
| `provider_connections` | workspace, provider=Resend, encrypted credentials, credential version, status, webhook secret reference |
| `sending_domains` | workspace, connection, normalized domain, provider ref, verification status |
| `sender_identities` | workspace, domain, allowed From/Reply-To, active/default flags |
| `organizations` | Prospect business records within workspace |
| `contacts` | Workspace contacts, normalized email, organization link, tags/metadata |
| `contact_consents` | Consent purpose/basis, timestamp, source, evidence and current state |
| `segments` | Server-side saved audience filters and creator |
| `campaigns` | Workspace, sender identity, content metadata, type, status, creator |
| `campaign_recipients` | Campaign and workspace, normalized email, recipient snapshot, status, provider ID |
| `campaign_events` | Recipient, provider event ID/type, timestamp, raw payload reference, dedupe key |
| `email_templates` | Workspace, content, variables, footer, version |
| `email_send_jobs` | Campaign batch/recipient claims, queue state, attempts, next attempt, error, idempotency |
| `follow_up_tasks` | Contact/campaign link, owner, due date, state and eligibility reasons |
| `suppressions` | Workspace and email (or normalized address hash), event reason, source, active status |
| `lead_activities` | Stage changes, notes, demos, proposal and conversion events |
| `audit_logs` | Actor, workspace, action, target, timestamp and safe redacted metadata |

**Constraints and integrity:**

- Role enum constrained to four workspace roles (Super Admin belongs outside memberships).
- Unique `(workspace_id, user_id)` membership; unique user username across the platform.
- Unique normalized domain across workspaces in Marketing OS.
- Campaign sender must reference an identity and connection belonging to same workspace; enforce via composite FK/DB constraints where practical, plus API authorization.
- Unique `(campaign_id, normalized_email)` recipient; unique provider event ID per connection where provider guarantees event uniqueness.
- Unique durable send claim keys; retry without duplicate provider submissions where possible. Exactly-once email delivery cannot be guaranteed during network ambiguity; record ambiguous outcomes and reconcile before retry.
- RLS on all exposed tables; minimum privileges for app and worker database credentials.
- Do not allow free-form `workspace_id` mutation after row creation.

---

## 11. API and service boundaries

Define typed, versionable service contracts with Zod validation. Illustrative endpoints (adapt to route handlers as appropriate):

```text
POST   /api/admin/workspaces                 # Super Admin only
GET    /api/admin/workspaces
GET    /api/admin/workspaces/:id/invitations
POST   /api/admin/workspaces/:id/invitations/:inviteId/resend
POST   /api/auth/username-login              # server-side resolution + Auth sign-in
POST   /api/invitations/accept
GET    /api/workspaces/:workspaceId/overview
GET    /api/workspaces/:workspaceId/members
POST   /api/workspaces/:workspaceId/invitations
PATCH  /api/workspaces/:workspaceId/members/:memberId
POST   /api/workspaces/:workspaceId/resend-connections
POST   /api/workspaces/:workspaceId/sending-domains
POST   /api/workspaces/:workspaceId/sender-identities
GET    /api/workspaces/:workspaceId/contacts
POST   /api/workspaces/:workspaceId/contacts/import
GET    /api/workspaces/:workspaceId/campaigns
POST   /api/workspaces/:workspaceId/campaigns
POST   /api/workspaces/:workspaceId/campaigns/:id/test
POST   /api/workspaces/:workspaceId/campaigns/:id/dry-run
POST   /api/workspaces/:workspaceId/campaigns/:id/send
POST   /api/workspaces/:workspaceId/campaigns/:id/cancel
GET    /api/workspaces/:workspaceId/analytics
GET    /api/workspaces/:workspaceId/activity
POST   /api/webhooks/resend/:connectionId    # verify signature, no user cookie required
GET    /unsubscribe/:signedToken            # consent-safe destination
POST   /unsubscribe/:signedToken
```

Every API validates schema, session, role, workspace ownership and request bounds. Webhooks authenticate via provider signature rather than user cookies. Server routes never trust client-supplied role or provider key fields.

---

## 12. Campaign send workflow and resilience

```text
Authorized user creates DRAFT
        ↓
Select approved sender + eligible audience + content
        ↓
Preview / test / dry-run
        ↓
Manager/Admin confirms REAL SEND
        ↓
Server rechecks workspace, role, consent, suppression and sender
        ↓
Campaign QUEUED + recipient snapshots + durable send claims
        ↓
Persistent worker sends batched requests with correct connection
        ↓
Resend returns ACCEPTED or synchronous error
        ↓
Signed webhook delivers delivery/engagement/failure events
        ↓
Recipient and aggregate metrics update without duplicates
```

- Sending never depends on the browser staying open.
- Retries use exponential backoff and an attempt cap; failures are inspectable and recoverable.
- Batch job idempotency and recipient claim records survive worker restarts.
- Do not assume provider accepts = inbox delivery.
- Webhooks: raw body verification, timestamp window, per-connection signing secret, deduplication, idempotent status updates and safe handling of out-of-order events.
- Suppression checks must be performed at queue creation **and** immediately before provider send.
- Explicitly exclude synthetic/test destinations from production campaigns.
- Test sending goes only to an explicitly provided allowed test address; dry-run sends to no real contacts.
- Initial cap 1,000 recipients/campaign, provider batch <=100, UI default 25. Configurable workspace caps enforce actual provider limits.
- Marketing requires provable permission to contact; import checkbox is not itself recipient consent.

---

## 13. Performance / efficient querying requirements

- **Server-side pagination by default:** 50 rows; keyset/cursor pagination on large tables.
- Search/filter/sort/aggregate in PostgreSQL; never download entire datasets for browser filtering.
- Index `workspace_id` with frequent filters (`status`, `created_at`, normalized email, campaign ID).
- Full-text and `pg_trgm` only where justified by measured searches.
- TanStack Query cache keys always include current user + workspace + filters. Invalidate after mutations and clear restricted data on logout/workspace switches.
- Virtualize contact and event tables; lazy load heavy charts/modules.
- Use SQL aggregates or summary tables for frequent metrics. Avoid N+1 queries and unbounded `SELECT *`.
- Keep worker processing separate from synchronous dashboard requests.
- Measure with `EXPLAIN ANALYZE`, `pg_stat_statements`, structured logs and load tests.
- Targets (not guarantees): normal dashboard first useful content ~1.5 s; indexed common query <100 ms; cached interactions feel instant. Validate against production-like data and concurrency.
- Architectural growth targets: 100+ workspaces, 1M+ contacts and 10M+ events, subject to testing and hosting capacity.

---

## 14. Security and privacy non-negotiables

1. **Invite only.** No anonymous self-service organization or user creation.
2. **No shared role credentials.** Every employee has their own user account.
3. **Five roles, fixed definitions.** Only assignment of existing four company roles changes.
4. **RLS tenant boundaries.** Cross-workspace access fails in API, DB and caches.
5. **Secrets encrypted and server-only.** Never write Resend credentials to front-end bundles, logs, analytics or contact records.
6. **Verified sender/domain ownership.** No arbitrary From addresses or guessed provider domains.
7. **Personal email private.** User recovery email never becomes a campaign sender unless explicitly configured/verified as such.
8. **Strong credential controls.** Supabase Auth password hashing, rate limiting, secure cookies and verified recovery; no standalone PIN-only authentication.
9. **Webhook signature enforcement.** Validate exact connection, secret, freshness and deduplication.
10. **Consent/suppression always on.** Never send to unsubscribed, complained or hard-bounced addresses; comply with provider terms and applicable privacy requirements.
11. **Audit administrative and sending actions.** Record actors, company, action and time; redact secrets and sensitive message content.
12. **Safe privileged operations.** Service-role database credentials available only to backend/worker, not general client calls.
13. **No cross-tenant idempotency collisions.** All send jobs and webhooks scoped to connection and workspace.
14. **MFA/passkeys:** security hardening after MVP, preferably MFA for high-privilege accounts when supported.

---

## 15. Implementation plan for coding AI

### Phase A — must build first

- Initialize monorepo, pinned compatible dependencies, environment template and CI checks.
- Define five immutable roles and centralized permission helpers.
- PostgreSQL migrations, constraints, indexes, RLS and tests proving isolation.
- Invite-only Supabase Auth, username/password entry, password reset, profile/preferences.
- Super Admin company creation with **four mandatory initial invites**, outbox delivery, invite status/resend.
- First-login setup and multi-workspace switcher.
- Base design system, sidebar, themes, role-specific navigation and settings.

### Phase B — sending MVP

- Company Resend connection, domain/sender settings, encrypted credentials and connection test.
- Contact/organization CRUD, CSV import, evidence of consent, dedupe, saved segments.
- Templates + campaign list + builder + preview/test/dry-run.
- Queue + independent worker + send authorization + recipient snapshots.
- Verified webhook processing + suppression/unsubscribe + activity + core analytics.

### Phase C — complete workspace surfaces

- Sales pipeline, manual follow-up tasks and campaign-detail recipient events.
- All Settings tabs and audit/health visibility for the appropriate roles.
- UX polish for responsive layouts, loading/empty/error states, keyboard access.
- Monitoring, support runbook and end-to-end QA.

**Defer for later:** passkeys (after validation), custom roles, complex scheduled sequences, fully automatic domain DNS provisioning, Resend OAuth, inbound inbox/reply detection, AI writing/lead scoring, A/B testing, advanced attribution, third-party CRM integration, billing, Redis/Kafka/microservices.

**Development rule:** Build real functionality behind controls where marked as MVP. Do not create fake "Connected," "Verified," "Sent" or "Delivered" success states. For later features, show no misleading functional buttons.

---

## 16. Mandatory end-to-end acceptance tests

### Identity, roles and company provisioning

- [ ] Only Super Admin can create a company workspace.
- [ ] Company creation seeds all **four fixed roles** and issues four distinct initial invitations.
- [ ] Invite failure is visible and retryable without duplicate accounts.
- [ ] Each invite has exactly its intended role and intended workspace.
- [ ] Expired/revoked/consumed invitations cannot be reused.
- [ ] User activates with personal Gmail address, chooses username/password and completes onboarding.
- [ ] User invited to another workspace reuses same login; memberships and roles stay independent.
- [ ] Company Admin can add/suspend/reassign members only within authorized workspace.
- [ ] No company user can rename/delete/redefine fixed roles.
- [ ] Cannot accidentally remove the last functioning Company Admin without recovery controls.
- [ ] Agent cannot real-send by API tampering; Viewer cannot write by direct endpoints.
- [ ] Normal user cannot access another workspace via ID substitution, SQL RLS bypass or cached data.

### Resend domains and sending

- [ ] Day1Health and MyMentor connect separate credentials and domains without mixing keys.
- [ ] Sender dropdown shows only identities belonging to current workspace.
- [ ] Unverified or disabled sending identities cannot launch a campaign.
- [ ] Secret keys never appear in client responses, cookies, logs or browser storage.
- [ ] Manual test sends go only to the explicitly selected test address.
- [ ] Dry-run sends zero messages to actual recipients.
- [ ] Only a manager/admin with permission can enqueue a real send.
- [ ] Worker restart does not drop work or knowingly send already-accepted jobs again.
- [ ] Accepted and delivered are distinct states and metrics.
- [ ] Signed webhook updates recipient; invalid signature, stale payload and duplicate event rejected safely.
- [ ] Hard bounce, complaint and unsubscribe prevent all future marketing sends in required scope.
- [ ] Campaign recipient snapshots, audit and consent evidence are retained appropriately.

### User experience and performance

- [ ] All five roles can access their own personal Settings and change theme/density.
- [ ] Workspace Settings show only permission-appropriate company tabs.
- [ ] Sidebar, lists, forms, buttons and banners work at desktop and mobile viewport sizes.
- [ ] Contact and activity tables use server pagination, filtering and sorting.
- [ ] Company switcher never leaks previous company's contacts, charts or cached results.
- [ ] Every core route has correct loading, empty, error, no-access and retry states.
- [ ] No placeholder dashboard KPI is presented as actual data.

---

## 17. Decisions frozen for MVP

1. **One central Marketing OS**; not separate apps for Day1Health, MyMentor, Kervox, etc.
2. **Exactly five system roles:** one Super Admin + four automatic immutable workspace roles.
3. **Each new company gets four initial invitations**, one per role, delivered to real email addresses entered at creation.
4. **Email is for invites/recovery/notifications; username + password for MVP login.** No professional-looking login email requirement, no custom website PIN-only flow.
5. **Personal onboarding once:** choose password, username, profile, theme, timezone and notifications.
6. **Company-specific sending domains and Resend connections**, per-workspace approved sender identities and signed webhook handling.
7. **Per-user themes and Settings**; company settings visible/functional based on fixed role.
8. **Efficient indexed PostgreSQL querying and data virtualization**; no SEO work.
9. **No unsolicited cold outreach through Resend.** CRM prospect storage is separate from legal/provider-approved email eligibility.
10. **Build operational MVP in dependency order**, not a fake interactive demo.

**Use this document as the implementation contract.** The companion `MARKETING_OS_TECH_STACK.md` contains additional library, infrastructure, hosting and initialization details. Where an implementation detail is absent, choose the simplest secure production-aware approach consistent with the frozen decisions above.
