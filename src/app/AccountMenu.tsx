"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, ChevronDown, LogOut, UserPlus } from "lucide-react";
import type { SessionUser } from "@/services/auth/session";
import { ImportExportModal } from "./ImportExportModal";
import { ThemeToggle } from "./ThemeToggle";
import styles from "./AccountMenu.module.css";

/**
 * Replaces the old plain identity text + standalone Logout button + the
 * admin-only INVITE nav tab with a single dropdown trigger, matching the
 * visual style of the other top-nav tabs (`.tab` in Header.module.css).
 * Neither TagsInput (native <datalist>) nor ParentArticleSelect (native
 * <select>) in this codebase implement a custom dropdown with arrow-key
 * handling, so this menu's keyboard navigation is a minimal from-scratch
 * implementation rather than a mirrored pattern.
 */
export function AccountMenu({ user }: { user: SessionUser }) {
  const [open, setOpen] = useState(false);
  const [importExportOpen, setImportExportOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;

    // Move focus into the menu so arrow keys work immediately, matching the
    // standard menu-button pattern (the trigger's onKeyDown never sees
    // ArrowDown/ArrowUp since those handlers only listen on the menu itself).
    const firstItem = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]');
    firstItem?.focus();

    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  async function handleLogout() {
    setOpen(false);
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    if (items.length === 0) return;
    const currentIndex = items.indexOf(document.activeElement as HTMLElement);
    const delta = event.key === "ArrowDown" ? 1 : -1;
    const nextIndex = (currentIndex + delta + items.length) % items.length;
    items[nextIndex]?.focus();
  }

  return (
    <div className={styles.container} ref={containerRef}>
      <button
        type="button"
        ref={triggerRef}
        className={styles.trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${user.displayName} (${user.role})`}
        onClick={() => setOpen((value) => !value)}
      >
        {user.displayName} ({user.role})
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div className={styles.menu} role="menu" ref={menuRef} onKeyDown={handleMenuKeyDown}>
          {user.role === "admin" && (
            <Link href="/admin/invite" role="menuitem" className={styles.menuItem} onClick={() => setOpen(false)}>
              <UserPlus size={16} aria-hidden="true" />
              Invite
            </Link>
          )}
          <button
            type="button"
            role="menuitem"
            className={styles.menuItem}
            onClick={() => {
              setOpen(false);
              setImportExportOpen(true);
            }}
          >
            <ArrowLeftRight size={16} aria-hidden="true" />
            Import / Export
          </button>
          <ThemeToggle onToggled={() => setOpen(false)} />
          <button type="button" role="menuitem" className={styles.menuItem} onClick={handleLogout}>
            <LogOut size={16} aria-hidden="true" />
            Log out
          </button>
        </div>
      )}
      <ImportExportModal open={importExportOpen} onClose={() => setImportExportOpen(false)} />
    </div>
  );
}
