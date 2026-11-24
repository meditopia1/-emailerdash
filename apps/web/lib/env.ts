const requiredServer = ["SUPABASE_SERVICE_ROLE_KEY", "DATABASE_URL", "ENCRYPTION_MASTER_KEY"] as const;

export function serverEnv() {
  const missing = requiredServer.filter((key) => !process.env[key]);
  if (missing.length) throw new Error(`Missing server environment: ${missing.join(", ")}`);
  return { databaseUrl: process.env.DATABASE_URL!, encryptionKey: process.env.ENCRYPTION_MASTER_KEY!, serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY! };
}
