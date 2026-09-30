import matter from "gray-matter";
import type { Database } from "@/db/client";
import { FrontmatterSplitError, splitFrontmatterEntries } from "@/lib/frontmatter-file";
import { isStringArray } from "@/lib/request-fields";
import { ValidationError } from "@/services/errors";
import { createItem, type ImportableItemKind } from "@/services/items/items";

export interface ParsedItemEntry {
  title: string;
  url: string;
  tags: string[];
  description: string | null;
  notes: string;
}

/**
 * Parses a raw multi-entry file (ticket 01's splitter, then `gray-matter`
 * per chunk) into item entries of a single, caller-specified kind — no
 * per-entry "kind" field exists in the file at all; which kind these
 * entries become is chosen in the modal, not read from the file. Requires
 * a non-empty `title` and `url` — the same invariant `POST /api/items`
 * enforces for direct link/tool/article creation — all-or-nothing, same
 * rule as the flashcard importer (see flashcards-import.ts's
 * parseFlashcardsImportFile).
 */
export function parseItemsImportFile(raw: string): ParsedItemEntry[] {
  let chunks;
  try {
    chunks = splitFrontmatterEntries(raw);
  } catch (err) {
    if (err instanceof FrontmatterSplitError) {
      throw new ValidationError(`Could not parse the file: ${err.message}`);
    }
    throw err;
  }

  return chunks.map((chunk, index) => {
    const { data, content } = matter(`${chunk.frontmatterBlock}\n${chunk.body}`);

    const title = typeof data.title === "string" ? data.title.trim() : "";
    const url = typeof data.url === "string" ? data.url.trim() : "";
    const description = typeof data.description === "string" && data.description.trim() ? data.description : null;
    const notes = content.trim();

    if (!title) throw new ValidationError(`Entry ${index + 1}: missing "title"`);
    // Link/tool/article all require a url, same invariant POST /api/items
    // enforces for direct creation (src/app/api/items/route.ts) — the
    // import path must not create a link/tool/article with nothing to
    // link to just because the file's own validation only calls out title.
    if (!url) throw new ValidationError(`Entry ${index + 1}: missing "url"`);
    if (data.tags !== undefined && !isStringArray(data.tags)) {
      throw new ValidationError(`Entry ${index + 1}: "tags" must be a list of strings`);
    }
    const tags = data.tags ?? [];

    return { title, url, tags, description, notes };
  });
}

/**
 * `notes` (unlike `description`) is rendered through `MarkdownBlock` for
 * every item kind (see `ItemRow.tsx`), so these samples lean on it to show
 * off headings, emphasis, lists, links, and both inline and fenced code —
 * `description` stays plain prose since it's rendered as plain text and
 * markdown syntax there would just show up literally.
 */
const SAMPLE_ENTRIES: Record<ImportableItemKind, [ParsedItemEntry, ParsedItemEntry]> = {
  link: [
    {
      title: "Kubernetes RBAC Good Practices",
      url: "https://kubernetes.io/docs/concepts/security/rbac-good-practices/",
      tags: ["kubernetes", "security", "best-practices"],
      description: "Official guidance on configuring least-privilege RBAC for a cluster.",
      notes: [
        "## Why this matters",
        "",
        'Role-based access control is the boundary between "a workload can do its job" and "a workload can do *anything*". A few things worth remembering:',
        "",
        "- Prefer a namespaced `Role` + `RoleBinding` over a cluster-wide grant",
        "- Avoid wildcard verbs (`*`) and resources in production",
        "- Audit every `ClusterRoleBinding` on a **quarterly** cadence",
        "",
        "Useful check before shipping a new service account:",
        "",
        "```bash",
        "kubectl auth can-i --list --as=system:serviceaccount:default:my-service-account",
        "```",
        "",
        "See the [official guide](https://kubernetes.io/docs/concepts/security/rbac-good-practices/) for the full walkthrough.",
      ].join("\n"),
    },
    {
      title: "OWASP Top Ten",
      url: "https://owasp.org/www-project-top-ten/",
      tags: ["appsec", "reference"],
      description: "The industry-standard list of the ten most critical web application security risks.",
      notes: [
        "### How we use this internally",
        "",
        "Every new service gets checked against each category before it ships. The ones that bite us most:",
        "",
        "1. **Broken access control** — missing per-object authorization checks",
        "2. *Injection* — anywhere raw input reaches a query, shell, or template",
        "3. `Security misconfiguration` — default credentials, verbose errors in prod",
        "",
        "> If a finding maps to one of these, it blocks the release.",
      ].join("\n"),
    },
  ],
  tool: [
    {
      title: "kube-bench",
      url: "https://github.com/aquasecurity/kube-bench",
      tags: ["kubernetes", "cis-benchmark", "ci"],
      description: "Checks whether a cluster is deployed according to CIS Kubernetes Benchmark recommendations.",
      notes: [
        "## Where it runs",
        "",
        "Wired into the release pipeline as a **required** check:",
        "",
        "- Runs against every control-plane and worker node",
        "- Fails the build on any `FAIL` result above the agreed severity",
        "- Results are archived as a build artifact for audit",
        "",
        "```yaml",
        "- name: kube-bench",
        "  run: kube-bench run --targets master,node",
        "```",
        "",
        "Related reading: [CIS Kubernetes Benchmark](https://www.cisecurity.org/benchmark/kubernetes).",
      ].join("\n"),
    },
    {
      title: "trivy",
      url: "https://github.com/aquasecurity/trivy",
      tags: ["scanning", "supply-chain"],
      description: "Scans container images, filesystems, and IaC for known vulnerabilities and misconfigurations.",
      notes: [
        "### Typical invocation",
        "",
        "```bash",
        "trivy image --severity HIGH,CRITICAL myorg/myimage:latest",
        "```",
        "",
        "Also worth enabling for:",
        "",
        "- Infrastructure-as-code (`trivy config .`)",
        "- SBOM generation (`trivy image --format cyclonedx`)",
        "",
        "Treat any *CRITICAL* finding as a merge blocker.",
      ].join("\n"),
    },
  ],
  article: [
    {
      title: "A Deep Dive Into Container Escapes",
      url: "https://example.com/container-escapes",
      tags: ["containers", "research", "read-later"],
      description: "Long-form write-up on container breakout techniques and the kernel primitives behind them.",
      notes: [
        "## Summary",
        "",
        "Covers three escape classes in depth:",
        "",
        "1. Misconfigured **capabilities** (`CAP_SYS_ADMIN` in particular)",
        "2. Shared host namespaces (`hostPID`, `hostNetwork`)",
        "3. Vulnerable container runtimes",
        "",
        "> Worth re-reading before the next threat-modeling session.",
        "",
        "Companion repo with reproduction steps: [container-escapes-lab](https://example.com/container-escapes).",
      ].join("\n"),
    },
    {
      title: "The State Of Supply Chain Security",
      url: "https://example.com/supply-chain",
      tags: ["supply-chain", "industry-report"],
      description: "An annual survey of software supply-chain attack trends and how teams are responding.",
      notes: [
        "### Takeaways",
        "",
        "- Dependency confusion attacks are *up* year over year",
        "- SBOMs are becoming a `procurement` requirement, not just a nice-to-have",
        "- Signing artifacts (`cosign`, `sigstore`) is now table stakes",
        "",
        "Saved to read this weekend.",
      ].join("\n"),
    },
  ],
};

/**
 * A two-entry sample file per kind (ticket 07), downloadable from the
 * modal's Import step so a member has a working starting point without
 * guessing the shape — the file format is identical across kinds (no
 * per-entry "kind" field), so this only varies the illustrative example
 * content to read naturally for the chosen kind.
 */
export function buildItemImportSample(kind: ImportableItemKind): string {
  return SAMPLE_ENTRIES[kind]
    .map((entry) => {
      const data: Record<string, unknown> = { title: entry.title, url: entry.url, tags: entry.tags };
      if (entry.description) data.description = entry.description;
      return matter.stringify(entry.notes, data);
    })
    .join("");
}

export interface ImportItemsResult {
  created: number;
}

/**
 * Imports every entry in a raw multi-entry file as new items of `kind`
 * (ticket 07). Unlike the flashcard importer, this never matches/updates
 * an existing item — every entry always creates a new row, attributed to
 * `creatorId` (the importing member). Parsing happens up front and is
 * all-or-nothing (see parseItemsImportFile), and the writes are wrapped in
 * a single transaction so a failure partway through a large import can't
 * leave a partial batch committed either.
 */
export async function importItemsFile(
  db: Database,
  raw: string,
  kind: ImportableItemKind,
  creatorId: string,
): Promise<ImportItemsResult> {
  const entries = parseItemsImportFile(raw);

  return db.transaction(async (tx) => {
    for (const entry of entries) {
      await createItem(tx, {
        creatorId,
        kind,
        url: entry.url,
        title: entry.title,
        description: entry.description,
        notes: entry.notes,
        tags: entry.tags,
      });
    }
    return { created: entries.length };
  });
}
