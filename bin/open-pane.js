#!/usr/bin/env node
import { syncFromInvocation } from "../lib/sync.js";
import { ensurePrPane } from "../lib/pane.js";

try {
  const result = syncFromInvocation({ force: true });
  const opened = ensurePrPane(result.target, { snapshot: result.snapshot, focus: true });
  if (opened.skipped && opened.skipped !== "self") {
    console.error(`[github-pr] open pane skipped: ${opened.skipped}`);
    if (opened.stderr) console.error(opened.stderr);
    process.exit(1);
  }
  console.error(`[github-pr] ${opened.reused ? "focused" : "opened"} pane ${opened.paneId}`);
} catch (error) {
  console.error(`[github-pr] open pane failed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
