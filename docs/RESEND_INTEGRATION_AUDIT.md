# Resend integration audit

Inspected before implementation, 2026-11-21.

## Reuse

- Settings → Email setup (`dashboard/forms.tsx`), dashboard tokens and appearance preferences.
- Singleton `mail_settings`, AES-256-GCM helpers, server-only master key and environment credentials.
- Admin session middleware and explicit campaign API guard (authentication, same-origin writes).
- Existing campaign/draft endpoints, sender snapshots, recipient IDs and provider message IDs.
- Existing `mail_events`, suppressions, campaign counters and recipient activity endpoints.
- Existing `/api/webhooks/resend/[connectionId]` URL, not a second webhook implementation.

## Missing or unsafe

- Campaign dispatch now uses a bounded durable queue and worker with pre-send eligibility checks, idempotency, retries, and status updates.
- Resend dependency installed, but no backend sending service. Add one bounded provider adapter for explicit tests; no competing campaign queue.
- Current webhook only logs payloads; its custom HMAC is not Svix verification. Replace with raw-body Svix verification and atomic event processing.
- Settings PUT overwrites encrypted credentials from environment on identity updates. Replace with explicit credential actions, preserving existing configuration.
- No connection validation evidence, multiple domains/identities, credential rotation invalidation or integration audit trail.
- Dashboard totals count sampled raw events, not unique recipients. Replace with database aggregation; retain repeated events in the timeline.

## Implementation boundaries

Add migration `0006_resend_integration.sql`, private tables only for domains, identities, integration audit, explicit test results and durable rate limits. Extend existing settings/recipient tables. Do not alter historical campaign sender snapshots, automatically change DNS, delete Resend domains, or make provider calls when saving forms.

Sending-only keys never invoke management APIs. Managed-domain operations require explicit Full Access opt-in. Manual domain entry remains self-reported; an accepted test is sending evidence, not DNS verification. Credential replacement invalidates previous credential-specific validation. Disconnect prevents fallback to environment credentials.

Automated provider tests use injected mock transport. Browser tests must not send email or change live provider resources. Database fixtures are isolated and cleaned by their exact IDs, preserving user data.

## Provider references

- [API key permissions](https://resend.com/docs/api-reference/api-keys/create-api-key)
- [Domain retrieval and real DNS records](https://resend.com/docs/api-reference/domains/get-domain)
- [Domain tracking configuration](https://resend.com/changelog/update-click-open-tracking-via-api)
- [Raw-body webhook verification](https://resend.com/docs/webhooks/verify-webhooks-requests)
- [Email sending and provider acceptance](https://resend.com/docs/api-reference/emails/send-email)
