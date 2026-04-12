import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { db } from "@/lib/db";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(db),
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID!,
      clientSecret: process.env.AUTH_GOOGLE_SECRET!,
      authorization: {
        params: {
          scope:
            "openid email profile https://www.googleapis.com/auth/gmail.readonly",
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
  ],
  events: {
    async createUser({ user }) {
      // First sign-in: create a personal organization after the adapter persists the user
      if (!user.id) return;
      try {
        const slug =
          (user.email?.split("@")[0] ?? "user")
            .toLowerCase()
            .replace(/[^a-z0-9-]/g, "-") +
          "-" +
          Date.now().toString(36);

        await db.organization.create({
          data: {
            name: user.name ? `${user.name}'s Workspace` : "My Workspace",
            slug,
            members: {
              create: { userId: user.id, role: "OWNER" },
            },
          },
        });
      } catch (e) {
        console.error("[auth] Failed to create org for new user:", e);
      }
    },
    async signIn({ user, account, isNewUser }) {
      // Store / refresh Gmail tokens AFTER sign-in is fully committed
      try {
        if (account?.provider !== "google" || !account.access_token || !user.id || !user.email) return;

        const membership = await db.organizationMember.findFirst({
          where: { userId: user.id },
          select: { organizationId: true },
        });
        if (!membership) return;

        await db.gmailConnection.upsert({
          where: {
            organizationId_email: {
              organizationId: membership.organizationId,
              email: user.email,
            },
          },
          update: {
            accessToken: account.access_token,
            refreshToken: account.refresh_token ?? null,
            tokenExpiry: account.expires_at
              ? new Date(account.expires_at * 1000)
              : null,
            isActive: true,
            lastUsedAt: new Date(),
          },
          create: {
            organizationId: membership.organizationId,
            email: user.email,
            accessToken: account.access_token,
            refreshToken: account.refresh_token ?? null,
            tokenExpiry: account.expires_at
              ? new Date(account.expires_at * 1000)
              : null,
            scopes: account.scope?.split(" ") ?? [],
          },
        });
      } catch (e) {
        console.error("[auth] Failed to store Gmail tokens:", e);
      }
    },
  },
  callbacks: {
    async signIn() {
      return true;
    },
    async session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;

        try {
          const membership = await db.organizationMember.findFirst({
            where: { userId: user.id },
            include: { organization: true },
            orderBy: { joinedAt: "asc" },
          });

          if (membership) {
            (session as any).organizationId = membership.organizationId;
            (session as any).organizationName = membership.organization.name;
            (session as any).role = membership.role;
          }
        } catch (e) {
          console.error("[auth] Failed to load org for session:", e);
        }
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "database",
  },
});
