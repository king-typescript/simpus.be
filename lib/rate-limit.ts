import { prisma } from "@/lib/prisma";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED = 5;
const RATE_LIMIT_ENTITY = "RateLimit";

export type RateLimitKey = string | null;

/**
 * Limit failed logins per identity (school:username) AND per IP.
 * Keys[0] is the account identity; the rest are IPs. A null IP is not
 * limited by IP but the account key still applies, so lockout cannot be
 * bypassed by spoofing X-Forwarded-For.
 */
export async function isRateLimited(keys: RateLimitKey[]): Promise<boolean> {
  const since = new Date(Date.now() - WINDOW_MS);
  const [identity, ...ips] = keys;
  const ipList = ips.filter((ip): ip is string => ip !== null);

  if (ipList.length) {
    const byIp = await prisma.auditLog.count({
      where: {
        action: "LOGIN_FAILED",
        entityType: { not: RATE_LIMIT_ENTITY },
        ipAddress: { in: ipList },
        createdAt: { gte: since },
      },
    });
    if (byIp >= MAX_FAILED) return true;
  }

  if (!identity) return false;
  const byAccount = await prisma.auditLog.count({
    where: {
      action: "LOGIN_FAILED",
      entityType: RATE_LIMIT_ENTITY,
      entityId: identity,
      createdAt: { gte: since },
    },
  });
  return byAccount >= MAX_FAILED;
}

/** Record an account-scoped failure marker (independent of IP). */
export async function recordAccountFailure(identity: string, ip: string | null): Promise<void> {
  // ponytail: reuse AuditLog as the counter store; move to a dedicated table
  // (or in-memory bucket) when login volume makes audit rows noisy.
  await prisma.auditLog.create({
    data: {
      schoolId: null,
      userId: null,
      action: "LOGIN_FAILED",
      entityType: RATE_LIMIT_ENTITY,
      entityId: identity,
      ipAddress: ip,
    },
  }).catch(() => {});
}
