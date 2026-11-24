# Marketing OS Lite — Phase 1 Implementation Plan

`MARKETING_OS_LITE_UPDATED_ENGINEERING_SPEC.md` is the active Phase 1 source of truth. Earlier multi-company and multi-role specifications are deferred context only.

## Build order

1. Secure single-admin session and protected dashboard.
2. Six-table PostgreSQL mail model with private server-only access.
3. Email Setup with encrypted Resend credentials and test send.
4. Contact CSV/manual import, consent evidence and suppressions.
5. Compose, preview, draft, test-send and explicit Send Now.
6. Durable PostgreSQL queue with bounded retries, cancellation and idempotency.
7. Signed Resend webhooks, event deduplication and suppression updates.
8. Overview metrics, campaign history and recipient activity.
9. Public unsubscribe flow.
10. End-to-end tests, HTTPS deployment and small live campaign.

## Explicitly deferred

Workspaces, roles, invitations, onboarding, multiple Resend connections, scheduling, sequences, CRM, AI, billing, SEO, Redis, Prisma, Elasticsearch and automatic DNS provisioning.

## Acceptance

One admin can configure a verified sender, import consented contacts, compose and test an email, launch a small real campaign, monitor queue progress after logout, receive signed provider events, inspect recipient history, and immediately suppress unsubscribed/bounced/complained recipients.
