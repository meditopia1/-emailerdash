export type SendJob = { id: string; workspaceId: string; recipientId: string; attempts: number };

export function claimable(job: SendJob, now = Date.now()) {
  return Boolean(job.id && job.workspaceId && job.recipientId && job.attempts >= 0 && now > 0);
}
