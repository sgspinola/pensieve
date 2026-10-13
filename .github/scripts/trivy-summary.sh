#!/usr/bin/env bash
# Ticket 63: image.yml's `trivy` step summary. Reads FINDINGS (the
# upload-sarif action's count, empty when Trivy wrote no SARIF) and lists
# findings from trivy-vuln.sarif.
set -euo pipefail

if [ -n "$FINDINGS" ]; then
  n=$FINDINGS
  icon=$([ "$n" -eq 0 ] && echo ":white_check_mark:" || echo ":x:")
  echo "### trivy $icon $n fixable vulnerabilit$([ "$n" -eq 1 ] && echo y || echo ies) in the image" >> "$GITHUB_STEP_SUMMARY"
  # Each result's message is "Key: value" lines (Package, Severity, ...).
  # The first 20 are listed; the rest are in Code Scanning.
  jq -r '[.runs[].results[]][:20][]
    | (.message.text | [split("\n")[] | capture("^(?<key>[^:]+): (?<value>.*)$")] | from_entries) as $m
    | "- `\(.ruleId)` \($m.Severity): \($m.Package) \($m["Installed Version"]), fixed in \($m["Fixed Version"])"' \
    trivy-vuln.sarif >> "$GITHUB_STEP_SUMMARY"
else
  echo "### trivy :x: Trivy produced no SARIF" >> "$GITHUB_STEP_SUMMARY"
fi
