export const roles = ["super_admin", "company_admin", "marketing_manager", "marketing_agent", "viewer"] as const;
export type Role = (typeof roles)[number];

export const workspaceRoles = roles.filter((role): role is Exclude<Role, "super_admin"> => role !== "super_admin");

export const permissions = {
  super_admin: ["platform:manage", "workspace:manage", "send:real"],
  company_admin: ["workspace:manage", "members:manage", "integrations:manage"],
  marketing_manager: ["campaigns:manage", "campaigns:send", "templates:manage"],
  marketing_agent: ["contacts:manage", "templates:manage", "campaigns:draft"],
  viewer: ["reports:read"]
} as const satisfies Record<Role, readonly string[]>;

export type CampaignStatus = "draft" | "queued" | "sending" | "sent" | "failed" | "cancelled";
export type InvitationStatus = "invited" | "accepted" | "onboarding" | "active" | "expired" | "revoked" | "suspended";
export type ProviderConnectionStatus = "self_reported" | "provider_verified" | "test_send_passed" | "enabled" | "disabled";
export type SendJobStatus = "queued" | "claimed" | "succeeded" | "retrying" | "dead_letter" | "cancelled";

export type WorkspaceMembership = { workspaceId: string; userId: string; role: Exclude<Role, "super_admin"> };
export type AuditEvent = { actorId: string | null; workspaceId: string | null; action: string; entityType: string; entityId: string | null; metadata?: Record<string, unknown> };

export function can(role: Role, permission: string) {
  return (permissions[role] as readonly string[]).indexOf(permission) !== -1;
}
