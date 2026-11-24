# Marketing OS — Technology Stack & Project Initialization

**Status:** Approved starting architecture  
**Date:** 2026-11-21  
**Product:** Private, multi-company marketing and email management platform  
**Primary objective:** Fast, secure, data-heavy internal dashboards. **No SEO required.**

## 1. Architecture Decision

Build a **TypeScript modular monolith** with a separate persistent background worker.

```text
Users (one secure login each)
    ↓
Next.js dashboard (Vercel)
    ├── Workspace-specific UI and server APIs
    ├── Supabase Auth (identities and sessions)
    ├── Supabase PostgreSQL (RLS, indexed queries, data)
    └── Enqueue outbound email work
                  ↓
        PostgreSQL-backed job queue
                  ↓
        Dedicated Node.js worker (always running)
                  ↓
        Resend connection selected by workspace
                  ↓
        Signed Resend webhooks → event records / analytics / suppressions
```

**Do not** create independent applications or databases for Day1Health, MyMentor and Kervox. They are isolated **company workspaces** inside the same platform, with strict database and API authorization. A user may belong to several workspaces with different company roles.

## 2. Core Technology Stack

| Layer | Technology | Decision / rationale |
|---|---|---|
| Runtime | **Node.js 24 LTS** | Standard development and worker runtime; align hosting support |
| Package manager | **pnpm** | Fast, reproducible installs and workspace support |
| Application | **Next.js App Router**, current stable compatible release | Authenticated dashboard, server-side routes, layouts |
| Language | **TypeScript** in strict mode | Typed models, safer refactoring |
| UI | **React** | Interactive dashboard components |
| Styling | **Tailwind CSS** + CSS design tokens | Consistent, theme-aware styling |
| Components | **shadcn/ui** + **Radix UI** + **Lucide** | Accessible, customizable controls |
| Themes | **next-themes** | System, light, dark and custom preset themes |
| Data fetching | **TanStack Query** | Client caching, invalidation, prefetching, deduplication |
| Data grids | **TanStack Table** + **TanStack Virtual** | Server-driven sorting/filtering, large virtualized lists |
| Forms | **React Hook Form** + **Zod** | Form validation and shared API schemas |
| Charts | **Recharts** | Campaign/analytics reporting |
| Database | **Supabase PostgreSQL** | Relational data, indexes, SQL functions, RLS |
| Authentication | **Supabase Auth** + SSR session helpers | Invite-only accounts, sessions, recovery |
| Authorization | **PostgreSQL RLS** + server authorization | Enforce workspace and role boundaries |
| DB access | **Supabase client** + explicit SQL migrations/RPC | Avoid heavy ORM for initial build |
| Job queue | **pg-boss** backed by PostgreSQL | Durable, retriable background email jobs |
| Worker hosting | **Railway / Render / Fly.io** (choose one) | Always-on worker independent of Vercel requests |
| Email service | **Resend API** | Sending, event webhooks, domain-restricted keys |
| Application hosting | **Vercel** | Next.js frontend and request/response APIs |
| Unit/integration tests | **Vitest** | Business rules and API validation |
| End-to-end tests | **Playwright** | Login, invitation, campaign sending workflows |
| Logging | Structured server/worker logs | Auditability and failure tracing |

**Version policy:** Pin exact compatible versions and commit `pnpm-lock.yaml` during project setup. Do not blindly install `latest` across incompatible Next.js/React/tooling versions.

## 3. Account, Role and Workspace Model

### Fixed roles: exactly five

1. **Super Admin** — one platform-level role, global administration.
2. **Company Admin** — full administration of assigned workspace(s).
3. **Marketing Manager** — campaign creation, approval and sending.
4. **Marketing Agent** — contacts, drafts, templates, follow-up preparation; no real-send permission.
5. **Viewer** — read-only access to permitted workspace reporting.

**System rule:** The four company roles exist automatically for **every new workspace**. Their names/definitions/permission sets are fixed in code and cannot be changed from the dashboard. A workspace contains users *assigned* to these roles, not independent editable role definitions.

### Company provisioning

1. Super Admin creates company workspace (e.g., Day1Health, MyMentor, Kervox).
2. Provision the four fixed workspace role slots.
3. Enter invitation email addresses for the **four initial accounts** (one per role).
4. Generate pending invitations/memberships and send secure single-use activation links.
5. Recipient activates account, chooses a unique **username** and **password**, and completes brief onboarding.
6. Onboarding collects name, optional avatar, theme, accent, density, timezone and notification preferences.
7. Membership becomes active; user sees only authorized workspaces.
8. Existing users invited to additional workspaces **keep the same identity/password** and gain a new membership.

**Important:** Roles exist automatically; user accounts can only be activated through valid invitation emails. Never fabricate email addresses or email passwords. Invitation/recovery email need not match the company's domain.

### Login and identifiers

- **Primary MVP login:** username + password, backed by Supabase Auth.
- **Invitation/recovery address:** verified personal or work email, held separately from username.
- **Campaign sender address:** authorized, verified company sending identity; unrelated to login email.
- Supabase Auth is email-oriented: resolve a **globally unique username server-side** to its linked auth identity, then perform password authentication on the server. Do not expose the lookup email to browsers or public responses. Apply rate limiting, generic errors and anti-enumeration safeguards.
- Store password hashes/sessions in **Supabase Auth only**; never invent custom password hashing tables.
- **Passkeys (WebAuthn)** are a preferred future fast-login upgrade after compatibility and recovery flow testing; native Supabase passkeys are currently beta. Do not ship a custom 4–6-digit PIN-only authentication flow.
- Default public self-signup **disabled**; invitation-only provisioning.

### Database authorization essentials

- `profiles` and `workspace_memberships` associate `auth.users.id` with workspaces and roles.
- `platform_admins` (or equivalent server-controlled claim/table) identifies Super Admins.
- Every company-owned row contains immutable `workspace_id`.
- RLS on all exposed tables, with membership/role checks and appropriate indexes.
- Every server action/API request rechecks authorization; hiding a button is never authorization.
- A Super Admin may access all workspaces through explicitly guarded privileged APIs, not unrestricted public client queries.

## 4. Resend Multi-Company Sending

Each workspace may have one or more **Resend connections**, sending domains and sender identities.

**Recommended topology:** use separate Resend teams/accounts for operationally independent clients where appropriate; at minimum use **one domain-restricted sending API key per workspace/domain**. Never reuse a global sending key across unrelated companies.

Connection onboarding:

1. Create workspace and choose its default sender details.
2. Verify the custom domain or marketing subdomain in Resend using the required DNS records.
3. Generate a **sending-only, domain-restricted API key** in Resend.
4. Store the key encrypted **server-side** (AES-256-GCM with managed master key or a managed secret store; never readable by client users).
5. Configure appropriate signed webhook endpoint, e.g. `/api/webhooks/resend/[connectionId]`.
6. Store each connection's webhook signing secret encrypted.
7. Validate connection/domain ownership and send a test email.
8. Enable sending only when verification, permissions and webhook setup pass.

**Never ask for or store a user's Resend account password.** Store restricted API credentials only. A separate full-access credential is optional for later resource automation and must not be required for MVP.

### Send handling

- `draft → queued → sending → sent / failed / cancelled` with recipient-level outcomes.
- Resend **accepted** is not **delivered**; webhook events populate delivery, open, click, bounce and complaint metrics.
- Persist recipient snapshots at send time, with server-side deduplication and validation.
- Enforce opt-in/consent eligibility, unsubscribes, complaints and hard-bounce suppression on every real send.
- **Do not use Resend for unsolicited cold outreach or scraped/purchased recipient lists.** Prospect records may exist in CRM without send permission.
- Support test send and a safe simulated/dry-run mode before real sending.
- Queue batch sends; use provider-size limits, per-connection throttling, exponential backoff and dead-letter handling.
- Use database uniqueness/claim records for durable duplicate-send protection, not provider idempotency alone.
- Webhook handler reads **raw request body**, verifies signature and freshness, deduplicates event IDs, verifies connection ownership, and then mutates records.
- An unsubscribe must block all future eligible marketing sends for the applicable company/domain policy.

## 5. UI / Design System

**Style:** premium minimal SaaS, data-dense, clean and calm; inspired by Linear / Attio / Resend / Stripe. No SEO work, marketing-site animation or decorative glassmorphism.

- Collapsible sidebar; persistent workspace switcher; responsive page layout.
- Compact data tables, sticky headers, server-side search/filter/sort, virtualized rows.
- Command palette and keyboard shortcuts where useful.
- Slide-over drawers for quick edits; full pages for complex workflows.
- Skeleton placeholders, proper empty/error/retry states and optimistic actions where safe.
- Inter font, Lucide icons, accessible keyboard and screen-reader behavior.
- **Six initial themes:** Light, Dark, Midnight, Graphite, Warm and High Contrast.
- Support system theme, custom accent, and compact/comfortable/spacious density.
- User appearance and notification preferences saved individually, not globally per company.
- Every role gets **Settings**, but only sections authorized for that role.

## 6. Pages and Routes

All internal pages require authentication and workspace membership.

| Page | Route | Function |
|---|---|---|
| Login / invitation / onboarding | `/login`, `/invite/accept`, `/onboarding` | Secure account activation and personal setup |
| Global overview | `/dashboard` | Cross-workspace overview, Super Admin only |
| Companies | `/companies` | Company management and provisioning, Super Admin only |
| Workspace overview | `/w/[slug]/overview` | Company-scoped KPIs and activity |
| Contacts | `/w/[slug]/contacts` | CRUD, CSV imports, segments, consent |
| Companies / prospects | `/w/[slug]/organizations` | Prospect business profiles |
| Sales pipeline | `/w/[slug]/pipeline` | Lead stages, notes and outcomes |
| Campaigns | `/w/[slug]/campaigns` | Campaign list, status, filters |
| Campaign builder | `/w/[slug]/campaigns/new` | Audience, sender, template, preview, launch |
| Campaign detail | `/w/[slug]/campaigns/[id]` | Recipient events, metrics, errors |
| Follow-ups | `/w/[slug]/follow-ups` | Manual eligible follow-ups and tasks |
| Templates | `/w/[slug]/templates` | Email content and personalization |
| Email activity | `/w/[slug]/activity` | Webhook-derived event history |
| Analytics | `/w/[slug]/analytics` | Delivery and sales reporting |
| Suppressions | `/w/[slug]/suppressions` | Unsubscribed/bounced/complained recipients |
| Workspace settings | `/w/[slug]/settings` | Company config; permission-gated tabs |
| Personal settings | `/account/settings` | Theme, profile, security, preferences |
| Platform settings | `/admin/settings` | Super Admin platform administration |

### Settings by role

- **Super Admin:** platform, workspaces, users, role assignment, integration health, global limits, security, compliance, logs.
- **Company Admin:** company profile, staff invitations, branding, Resend connections, domains, approved senders, limits, defaults, audit logs.
- **Marketing Manager:** campaign defaults, templates, segmentation defaults, sending identity selection, follow-up preferences, reports, permitted suppression actions.
- **Marketing Agent:** draft defaults, contact/table preferences, reminders, personal settings.
- **Viewer:** reporting preferences, layout and personal settings only.

## 7. Database Tables (MVP)

```text
profiles
platform_admins
workspaces
workspace_memberships
workspace_invitations
user_preferences
provider_connections
sending_domains
sender_identities
organizations
contacts
contact_consents
segments
campaigns
campaign_recipients
campaign_events
email_templates
email_send_jobs
follow_up_tasks
suppressions
lead_activities
audit_logs
```

Use SQL migrations in version control. Index common access paths, typically `workspace_id` + relevant `status`, `created_at`, and foreign key; normalized email uniqueness is scoped appropriately. Prefer explicit column selections and parameterized queries.

## 8. Performance Rules

- Default **50 rows per page**, with cursor/keyset pagination for large lists.
- Sorting, searching, filtering and aggregations run in PostgreSQL, not across downloaded rows.
- Use **TanStack Query** with workspace-aware cache keys, stale times and targeted invalidation.
- Virtualize large visible data grids. Never render thousands of DOM rows at once.
- Put indexes on actual high-volume filter/sort paths and RLS membership joins.
- Use PostgreSQL `EXPLAIN (ANALYZE, BUFFERS)` and `pg_stat_statements` to inspect slow queries.
- Use database summary tables / precomputed counters when event aggregates grow.
- Separate read/query work from sending workers; don't block HTTP requests waiting for bulk mail.
- Avoid `SELECT *`, unbounded API queries, N+1 request patterns and unpaginated exports.
- Secure workspace-aware caches. Clear user-specific sensitive caches on sign-out or account switch.
- Performance targets are **goals to load-test**, not guarantees: cached navigation <100 ms, ordinary indexed queries <100 ms, initial workspace dashboard ~1.5 s in normal conditions.
- Design for growth to **100+ workspaces, 1M+ contacts and 10M+ email events**, validating capacity through benchmarks.

## 9. Deployment and Environment

Use one application deployment, one dedicated worker deployment and one managed Postgres/Auth instance to start.

**Environment variable placeholders** (names may be adjusted during implementation):

```dotenv
# Public, safe-to-expose settings
NEXT_PUBLIC_APP_URL=https://your-app.example
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=

# Private: NEVER prefix secrets with NEXT_PUBLIC_
SUPABASE_SERVICE_ROLE_KEY=
DATABASE_URL=
ENCRYPTION_MASTER_KEY=
INVITATION_FROM_EMAIL=
INVITATION_RESEND_API_KEY=

# Worker-specific configuration
WORKER_DATABASE_URL=
WORKER_CONCURRENCY=5
```

Workspace-specific `Resend` sending keys and webhook secrets belong in encrypted database-backed **provider connection records** or a managed vault, **not** a single `.env` shared across companies. Invitation email sender belongs to the platform and uses its own verified sending identity.

Ensure database roles for worker/pg-boss are appropriately scoped, secrets are rotated safely, and only server processes receive privileged database credentials.

## 10. Repository Layout

```text
marketing-os/
├── apps/
│   ├── web/                 # Next.js application, UI, authenticated APIs
│   └── worker/              # Persistent email sending and retry worker
├── packages/
│   ├── ui/                  # Theme-aware shared components
│   ├── shared/              # Types, Zod schemas, constants, role matrix
│   └── email/               # Resend adapter, personalization, safeguards
├── supabase/
│   ├── migrations/          # SQL schema + RLS + indexes
│   └── seed.sql             # Local seed data only; no real credentials
├── tests/
├── docs/
│   └── TECH_STACK.md
├── .env.example
├── pnpm-workspace.yaml
└── pnpm-lock.yaml
```

## 11. Implementation Order (Today)

**Priority A — working foundation**

1. Initialize pnpm TypeScript workspace, Next.js, Tailwind, shadcn/ui and Vitest.
2. Create SQL migrations, fixed role constants and workspace-aware RLS.
3. Build invite-only authentication, username/password login, invitation redemption and onboarding.
4. Build workspace switcher and role-specific navigation/settings.
5. Build company creation with four initial invitation addresses and fixed role assignment.
6. Build company Resend connection settings and encrypted secret storage.

**Priority B — usable email MVP**

7. Contact management, CSV validation/import, consent snapshots and suppression checks.
8. Templates, personalization, campaign draft builder and test send.
9. Durable send queue + independent worker + real send authorization.
10. Signed webhooks, recipient events, delivery reports and basic analytics.
11. Manual follow-up tasks and basic sales pipeline.

**Definition of done:** A Super Admin can create a workspace; four invited users can activate their accounts; the admin can connect a verified Resend domain; a manager can create, test and send to **eligible opted-in** recipients; provider webhook events update delivery metrics; an Agent cannot real-send; Viewer is read-only; cross-workspace access is denied; and a failed worker can restart safely without silently dropping jobs.

## 12. Defer Until After MVP

- AI writing/lead scoring and scraping integrations.
- Automated multi-step sequences and scheduled campaigns.
- Auto-provisioning Resend domains/webhooks through full-access API.
- Inbound inbox/reply sync and automatic reply detection.
- Advanced ROI attribution, A/B tests, CRM connectors.
- Redis, Elasticsearch, Kafka, microservices, Kubernetes and separate per-company databases.
- Passkey-first login until beta compatibility and recovery flows are verified.

## 13. Official References

- Next.js: https://nextjs.org/docs
- Supabase Auth: https://supabase.com/docs/guides/auth
- Supabase passkeys (beta): https://supabase.com/docs/guides/auth/passkeys
- Supabase RLS: https://supabase.com/docs/guides/database/postgres/row-level-security
- TanStack Query: https://tanstack.com/query/latest
- TanStack Table: https://tanstack.com/table/latest
- TanStack Virtual: https://tanstack.com/virtual/latest
- pg-boss: https://pgboss.io/introduction
- Resend API keys: https://resend.com/changelog/new-api-key-permissions
- Resend webhooks: https://resend.com/docs/dashboard/webhooks/introduction
- Resend acceptable use: https://resend.com/legal/acceptable-use

---

**Non-negotiables:** fixed five-role model; four initial role invitations on company creation; username/password account activation; multi-company RLS isolation; encrypted per-company Resend credentials; validated webhook signatures; durable background sending; strict suppression and consent rules; efficient paginated SQL-backed dashboards; per-user appearance/settings.
