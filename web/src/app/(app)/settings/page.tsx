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

      <div className="space-y-5 stagger">
        {/* Gmail Connections */}
        <div className="card-glow overflow-hidden">
          <div className="flex items-center gap-3.5 px-6 py-4 border-b border-border/40">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 border border-primary/25 shadow-md shadow-primary/10">
              <Mail className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-bold">Gmail Connections</h3>
              <p className="text-xs text-muted-foreground/70">
                Connected accounts used for scanning
              </p>
            </div>
          </div>
          <div className="px-6 py-5">
            {connections.length > 0 ? (
              <div className="space-y-3">
                {connections.map((conn) => (
                  <div
                    key={conn.id}
                    className="flex items-center justify-between py-2.5 px-3 rounded-xl hover:bg-muted/15 transition-colors -mx-3"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary/15 to-primary/5 border border-primary/12 text-xs font-bold text-primary">
                        {conn.email[0].toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm font-semibold">{conn.email}</p>
                        <p className="text-xs text-muted-foreground/60">
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
              <p className="text-sm text-muted-foreground/70">
                No Gmail accounts connected. Sign out and sign in again with
                Gmail to connect.
              </p>
            )}
          </div>
        </div>

        {/* Organization */}
        <div className="card-glow overflow-hidden">
          <div className="flex items-center gap-3.5 px-6 py-4 border-b border-border/40">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/15 border border-accent/25 shadow-md shadow-accent/10">
              <Building2 className="h-4 w-4 text-accent" />
            </div>
            <div>
              <h3 className="text-sm font-bold">Workspace</h3>
              <p className="text-xs text-muted-foreground/70">
                {org?.name}
              </p>
            </div>
          </div>
          <div className="px-6 py-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground/70">
                  Plan: <span className="text-foreground font-semibold">{org?.plan ?? "Free"}</span>
                </p>
              </div>
              <Badge variant="outline">{org?.slug}</Badge>
            </div>
          </div>
        </div>

        {/* Team */}
        <div className="card-glow overflow-hidden">
          <div className="flex items-center gap-3.5 px-6 py-4 border-b border-border/40">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary/15 border border-secondary/25 shadow-md shadow-secondary/10">
              <Users className="h-4 w-4 text-secondary" />
            </div>
            <div>
              <h3 className="text-sm font-bold">Team Members</h3>
              <p className="text-xs text-muted-foreground/70">
                {org?.members.length ?? 0} member(s)
              </p>
            </div>
          </div>
          <div className="px-6 py-5">
            <div className="space-y-2">
              {org?.members.map((member) => (
                <div
                  key={member.id}
                  className="flex items-center justify-between py-2.5 px-3 rounded-xl hover:bg-muted/15 transition-colors -mx-3"
                >
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-xl bg-muted/40 border border-border/60 flex items-center justify-center text-xs font-bold text-muted-foreground">
                      {member.user.name?.[0]?.toUpperCase() ?? "?"}
                    </div>
                    <div>
                      <p className="text-sm font-semibold">
                        {member.user.name ?? member.user.email}
                      </p>
                      <p className="text-xs text-muted-foreground/60">
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
        <div className="card-glow overflow-hidden">
          <div className="flex items-center gap-3.5 px-6 py-4 border-b border-border/40">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted/40 border border-border/60 shadow-sm">
              <Shield className="h-4 w-4 text-muted-foreground" />
            </div>
            <div>
              <h3 className="text-sm font-bold">Account</h3>
              <p className="text-xs text-muted-foreground/70">
                Signed in as {session.user.email}
              </p>
            </div>
          </div>
          <div className="px-6 py-5 flex items-center justify-between">
            <p className="text-sm text-muted-foreground/70">
              Read-only Gmail access. Only invoice metadata is stored.
            </p>
            <SignOutButton />
          </div>
        </div>
      </div>
    </div>
  );
}
