import { redirect } from "next/navigation";
import { requireCurrentUser } from "@/lib/current-user";
import { Header } from "@/app/Header";
import { Wordmark } from "@/app/Wordmark";
import { GenerateInviteButton } from "@/app/GenerateInviteButton";
import shellStyles from "@/app/page-shell.module.css";
import sectionStyles from "@/app/items/ItemsLibrary.module.css";

/**
 * Admin-only destination for invite generation (ticket 03), reachable from
 * the nav's [INVITE] tab rather than living inline on the workspace. This
 * redirect is UX/defense-in-depth only, mirroring the existing pattern where
 * requireCurrentUser redirects an unauthenticated visitor to /login —
 * createInvite already independently re-checks the caller's role against
 * the database.
 */
export default async function AdminInvitePage() {
  const user = await requireCurrentUser();
  if (user.role !== "admin") {
    redirect("/");
  }

  return (
    <main className={`${shellStyles.shell} ${shellStyles.wide}`}>
      <h1>
        <Wordmark />
      </h1>
      <Header user={user} />
      <section className={sectionStyles.section}>
        <h2 className={sectionStyles.heading}>Invite a member</h2>
        <GenerateInviteButton />
      </section>
    </main>
  );
}
