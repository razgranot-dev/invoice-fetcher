import { Mail, Building2, Users, Shield, CheckCircle2, XCircle } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { requireOrganization } from "@/lib/session";
import { getConnections } from "@/lib/data/connections";
import { db } from "@/lib/db";
import { SignOutButton } from "./sign-out-button";

export default async function SettingsPage() {
  const { session, organizationId } = await requireOrganization();
  const connections = await getConnections(organizationId);

  const org = await db.organization.findUnique({
    where: { id: organizationId },
    include: {
      members: {
        include: { user: { select: { name: true, email: true, image: true } } },
        orderBy: { joinedAt: "asc" },
      },
    },
  });

  return (
    <div className="space-y-8">
      <PageHeader title="Settings" description="Manage your account and workspace" />

      <div className="space-y-4">
        {/* Gmail Connections */}
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted/50 border border-border">
              <Mail className="h-4 w-4 text-muted-foreground" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">Gmail Connections</h3>
              <p className="text-xs text-muted-foreground">
                Connected accounts used for scanning
              </p>
            </div>
          </div>
          <div className="px-5 py-4">
            {connections.length > 0 ? (
              <div className="space-y-3">
                {connections.map((conn) => (
                  <div
                    key={conn.id}
                    className="flex items-center justify-between py-2"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/8 border border-primary/12 text-xs font-medium text-primary">
                        {conn.email[0].toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm font-medium">{conn.email}</p>
                        <p className="text-xs text-muted-foreground">
                          {conn._count.scans} scans &middot; Connected{" "}
                          {new Date(conn.connectedAt).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <Badge variant={conn.isActive ? "secondary" : "outline"}>
                      {conn.isActive ? (
                        <>
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Active
                        </>
                      ) : (
                        <>
                          <XCircle className="h-3 w-3 mr-1" />
                          Inactive
                        </>
                      )}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No Gmail accounts connected. Sign out and sign in again with
                Gmail to connect.
              </p>
            )}
          </div>
        </div>

        {/* Organization */}
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted/50 border border-border">
              <Building2 className="h-4 w-4 text-muted-foreground" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">Workspace</h3>
              <p className="text-xs text-muted-foreground">
                {org?.name}
              </p>
            </div>
          </div>
          <div className="px-5 py-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">
                  Plan: <span className="text-foreground font-medium">{org?.plan ?? "Free"}</span>
                </p>
              </div>
              <Badge variant="outline">{org?.slug}</Badge>
            </div>
          </div>
        </div>

        {/* Team */}
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted/50 border border-border">
              <Users className="h-4 w-4 text-muted-foreground" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">Team Members</h3>
              <p className="text-xs text-muted-foreground">
                {org?.members.length ?? 0} member(s)
              </p>
            </div>
          </div>
          <div className="px-5 py-4">
            <div className="space-y-3">
              {org?.members.map((member) => (
                <div
                  key={member.id}
                  className="flex items-center justify-between py-1"
                >
                  <div className="flex items-center gap-3">
                    <div className="h-7 w-7 rounded-full bg-muted border border-border flex items-center justify-center text-xs font-medium text-muted-foreground">
                      {member.user.name?.[0]?.toUpperCase() ?? "?"}
                    </div>
                    <div>
                      <p className="text-sm font-medium">
                        {member.user.name ?? member.user.email}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {member.user.email}
                      </p>
                    </div>
                  </div>
                  <Badge variant="outline">{member.role.toLowerCase()}</Badge>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Security / Account */}
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted/50 border border-border">
              <Shield className="h-4 w-4 text-muted-foreground" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">Account</h3>
              <p className="text-xs text-muted-foreground">
                Signed in as {session.user.email}
              </p>
            </div>
          </div>
          <div className="px-5 py-4 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Read-only Gmail access. Only invoice metadata is stored.
            </p>
            <SignOutButton />
          </div>
        </div>
      </div>
    </div>
  );
}
