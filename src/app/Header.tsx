"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { SessionUser } from "@/services/auth/session";
import { AccountMenu } from "./AccountMenu";
import styles from "./Header.module.css";

const NAV_TABS: readonly { href: string; label: string }[] = [
  { href: "/", label: "Library" },
  { href: "/wiki", label: "Wiki" },
  { href: "/flashcards", label: "Flashcards" },
];

/**
 * The persistent nav rendered on every authenticated page: left side is
 * route tabs (matching whichever route is active), right side is the
 * account dropdown (identity, and admin-only Invite / Log out actions).
 */
// A tab is active on an exact pathname match, or — for a non-root tab like
// [WIKI] — when the pathname is nested under it (e.g. `/wiki/<id>` should
// still highlight the `/wiki` tab). The root `/` tab intentionally never
// matches via the nested case, or it would light up for every route.
function isTabActive(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  return href !== "/" && pathname.startsWith(`${href}/`);
}

export function Header({ user }: { user: SessionUser }) {
  const pathname = usePathname();

  return (
    <header className={styles.header}>
      <nav className={styles.tabs}>
        {NAV_TABS.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className={isTabActive(pathname, tab.href) ? `${styles.tab} ${styles.tabActive}` : styles.tab}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      <AccountMenu user={user} />
    </header>
  );
}
