"use client";

import { useEffect, useState } from "react";

/**
 * Reads the `data-theme` attribute the root layout sets on `<html>` (see
 * layout.tsx) and stays in sync with it via a MutationObserver. Needed
 * because `ThemeToggle` flips the attribute through a `router.refresh()`
 * rather than remounting whatever reads it — a one-time read on mount alone
 * would miss a toggle that happens after this component is already mounted.
 */
export function useColorMode(): "dark" | "light" {
  const [mode, setMode] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const target = document.documentElement;
    const read = () => setMode(target.dataset.theme === "light" ? "light" : "dark");

    read();
    const observer = new MutationObserver(read);
    observer.observe(target, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  return mode;
}
