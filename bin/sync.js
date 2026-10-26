#!/usr/bin/env node
import { syncFromInvocation, syncTarget, resolveTarget } from "../lib/sync.js";
import { herdrJson } from "../lib/herdr.js";
import { isPrPane } from "../lib/pane.js";

const force = Boolean(process.env.HERDR_PLUGIN_ACTION_ID) || process.env.HERDR_PLUGIN_EVENT === "startup";

try {
  if (process.env.HERDR_PLUGIN_EVENT === "startup") {
    restoreThenRefresh();
  } else {
    const result = syncFromInvocation({ force });
    if (result.snapshot?.pr) {
      console.error(`[github-pr] synced #${result.snapshot.pr.number} ${result.snapshot.labels.pr}`);
    } else if (result.skipped) {
      console.error(`[github-pr] skipped ${result.skipped}`);
    } else {
      console.error(`[github-pr] ${result.snapshot?.message || "no pr"}`);
    }
  }
} catch (error) {
  console.error(`[github-pr] sync failed: ${error instanceof Error ? error.message : error}`);
}

function restoreThenRefresh() {
  const listed = herdrJson(["pane", "list"]);
  const panes = listed.data?.result?.panes || [];
  const seen = new Set();
  for (const pane of panes) {
    if (isPrPane(pane)) continue;
    const cwd = pane.foreground_cwd || pane.cwd;
    if (!cwd || seen.has(`${pane.workspace_id}:${cwd}`)) continue;
    seen.add(`${pane.workspace_id}:${cwd}`);
    syncTarget({ paneId: pane.pane_id, workspaceId: pane.workspace_id, cwd }, { force: false, notifyOnChange: false });
  }
  const focused = resolveTarget();
  if (focused.cwd) syncTarget(focused, { force: false, notifyOnChange: false });
}
