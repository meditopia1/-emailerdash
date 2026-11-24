export type EligibleRecipient = { email: string; optedIn: boolean; suppressed: boolean };

export function isEligibleRecipient(recipient: EligibleRecipient) { return recipient.optedIn && !recipient.suppressed; }

export function normalizeEmail(email: string) { return email.trim().toLowerCase(); }
