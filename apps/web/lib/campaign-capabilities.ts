/** Campaign dispatch is available after sender validation and audience approval. */
export const campaignCapabilities = {
  send: true,
  testSend: true,
  reason: "Launching creates a durable recipient queue. The worker checks consent and suppressions again immediately before each Resend request.",
} as const;
