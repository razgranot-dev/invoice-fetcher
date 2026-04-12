import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";

/**
 * Get the current authenticated session, or redirect to login.
 * Use this in Server Components and API routes.
 */
export async function requireSession() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }
  return session;
}

/**
 * Get the current user's organization ID, or redirect.
 */
export async function requireOrganization() {
  const session = await requireSession();
  const orgId = (session as any).organizationId as string | undefined;
  if (!orgId) {
    redirect("/login");
  }
  return { session, organizationId: orgId };
}
