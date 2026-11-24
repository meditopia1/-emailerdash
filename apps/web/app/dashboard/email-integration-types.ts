export type SendingDomain = {
  id: string; domain: string; provider_domain_id: string | null; verification_status: string;
  verification_source: "manual" | "provider"; last_checked_at: string | null; is_default: boolean; evidence_current: boolean;
  dns_records: { name: string; type: string; value: string; record?: string; priority?: number; ttl?: string | number; status?: string }[];
  open_tracking: boolean | null; click_tracking: boolean | null;
};
export type SenderIdentity = {
  id: string; domain_id: string; sender_name: string; from_email: string; reply_to: string | null; company_name: string;
  physical_address: string; is_default: boolean; last_test_at: string | null; sending_validated: boolean; production_eligible: boolean;
};
export type EmailIntegration = {
  connection: { configured: boolean; state: string; credential_source: string | null; masked_key: string | null; managed_domains: boolean; last_validated_at: string | null; last_test_at: string | null; error: string | null };
  domains: SendingDomain[]; identities: SenderIdentity[];
  webhook: { endpoint: string; secret_configured: boolean; last_verified_event_at: string | null; health: string };
  tests: { id: string; from_email: string; destination: string; status: string; provider_message_id: string | null; error_message: string | null; last_event_type: string | null; last_event_at: string | null; created_at: string }[];
  audit: { id: string; action: string; outcome: string; created_at: string }[];
};
