import { BookOpen, FileText, Link, Wrench, type LucideIcon } from "lucide-react";
import type { SerializedItem } from "./types";

const KIND_BADGE_LABELS: Record<SerializedItem["kind"], string> = {
  link: "Link",
  tool: "Tool",
  article: "Article",
  page: "Wiki",
};

export function kindBadgeLabel(kind: SerializedItem["kind"]): string {
  return KIND_BADGE_LABELS[kind];
}

// Card-header icon standing in for the text badge above (ItemRow's title
// row): kept keyed on the same `kind`/label pairing so the two never drift
// apart. The icon is decorative — `kindBadgeLabel` remains the accessible
// name, passed by the caller as a tooltip/aria-label.
const KIND_ICONS: Record<SerializedItem["kind"], LucideIcon> = {
  link: Link,
  tool: Wrench,
  article: FileText,
  page: BookOpen,
};

export function kindIcon(kind: SerializedItem["kind"]): LucideIcon {
  return KIND_ICONS[kind];
}
