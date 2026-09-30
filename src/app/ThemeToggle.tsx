"use client";

import { useRouter } from "next/navigation";
import { Moon, Sun } from "lucide-react";
import { useColorMode } from "./useColorMode";
import styles from "./AccountMenu.module.css";

const THEME_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * Rendered as a menu item inside AccountMenu. Writes the `theme` cookie
 * directly from the client (rather than through a new API route) since this
 * is a non-sensitive UI preference, not auth — the `httpOnly` hardening a
 * route handler would add isn't worth the indirection here. `router.refresh()`
 * re-renders the server tree, including the root layout's `data-theme` read
 * (see layout.tsx), with the new cookie value. `document.documentElement`
 * is also flipped synchronously first so the toggle feels instant rather
 * than waiting on the refresh round-trip.
 */
export function ThemeToggle({ onToggled }: { onToggled?: () => void }) {
  const router = useRouter();
  const mode = useColorMode();

  function handleToggle() {
    const next = mode === "dark" ? "light" : "dark";
    document.cookie = `theme=${next}; path=/; max-age=${THEME_COOKIE_MAX_AGE_SECONDS}; samesite=lax`;
    document.documentElement.dataset.theme = next;
    router.refresh();
    onToggled?.();
  }

  return (
    <button type="button" role="menuitem" className={styles.menuItem} onClick={handleToggle}>
      {mode === "dark" ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
      {mode === "dark" ? "Light mode" : "Dark mode"}
    </button>
  );
}
