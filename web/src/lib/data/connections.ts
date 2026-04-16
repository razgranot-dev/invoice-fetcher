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
  organizationId: string,
  connectionId: string,
  tokens: {
    accessToken: string;
    refreshToken?: string;
    tokenExpiry?: Date;
  }
) {
  // Verify the connection belongs to the organization before updating.
  // Uses findFirst + update pattern to enforce org-scoping since
  // GmailConnection has no compound unique on (id, organizationId).
  const conn = await db.gmailConnection.findFirst({
    where: { id: connectionId, organizationId },
    select: { id: true },
  });
  if (!conn) {
    throw new Error("Connection not found or does not belong to this organization");
  }

  return db.gmailConnection.update({
    where: { id: connectionId },
    data: {
      ...tokens,
      lastUsedAt: new Date(),
    },
  });
}
