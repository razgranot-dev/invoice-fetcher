import { db } from "@/lib/db";

export async function getConnections(organizationId: string) {
  return db.gmailConnection.findMany({
    where: { organizationId },
    select: {
      id: true,
      email: true,
      isActive: true,
      connectedAt: true,
      lastUsedAt: true,
      _count: {
        select: { scans: true },
      },
    },
    orderBy: { connectedAt: "desc" },
  });
}

export async function getActiveConnection(organizationId: string) {
  return db.gmailConnection.findFirst({
    where: { organizationId, isActive: true },
    orderBy: { lastUsedAt: "desc" },
  });
}

export async function refreshConnectionToken(
  connectionId: string,
  tokens: {
    accessToken: string;
    refreshToken?: string;
    tokenExpiry?: Date;
  }
) {
  return db.gmailConnection.update({
    where: { id: connectionId },
    data: {
      ...tokens,
      lastUsedAt: new Date(),
    },
  });
}
