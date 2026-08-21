import { herdrJson, runHerdr } from "./herdr.js";
import { loadPanes, rememberPane, forgetPane } from "./store.js";

const PLUGIN_ID = process.env.HERDR_PLUGIN_ID || "github-pr";
const TITLE_PREFIX = "GitHub PR";

export function shouldOpenPrPane(entrypoint = process.env.HERDR_PLUGIN_ENTRYPOINT_ID) {
  return entrypoint !== "pr";
}

export function paneTitle(snapshot) {
  if (!snapshot?.pr) return TITLE_PREFIX;
  return `${TITLE_PREFIX} #${snapshot.pr.number}`;
}

export function isPrPaneTitle(title) {
  return typeof title === "string" && title.startsWith(TITLE_PREFIX);
}

export function isPrPane(pane) {
  return Boolean(
    pane &&
      (isPrPaneTitle(pane.title) ||
        isPrPaneTitle(pane.label) ||
        isPrPaneTitle(pane.terminal_title) ||
        isPrPaneTitle(pane.terminal_title_stripped)),
  );
}

export function findLivePrPane(workspaceId) {
  if (!workspaceId) return null;
  const stored = loadPanes().workspaces?.[workspaceId]?.paneId;
  if (stored && paneExists(stored)) return stored;

  const listed = herdrJson(["pane", "list", "--workspace", workspaceId]);
  const panes = listed.data?.result?.panes || [];
  const match = panes.find((pane) => isPrPane(pane));
  return match?.pane_id || null;
}

export function ensurePrPane(target, { focus = false, snapshot = null } = {}) {
  if (!shouldOpenPrPane()) return { skipped: "self" };
  if (!target?.workspaceId) return { skipped: "no-workspace" };
  if (!snapshot?.pr) return { skipped: "no-pr" };

  const existing = findLivePrPane(target.workspaceId);
  if (existing) {
    rememberPane(target.workspaceId, existing);
    applyPaneTitle(existing, snapshot);
    if (existing === target.paneId) return { paneId: existing, reused: true, skipped: "already-open" };
    if (focus) runHerdr(["plugin", "pane", "focus", existing]);
    return { paneId: existing, reused: true };
  }

  const targetPane = resolveSplitTarget(target);
  if (!targetPane) return { skipped: "no-target-pane" };

  const args = [
    "plugin",
    "pane",
    "open",
    "--plugin",
    PLUGIN_ID,
    "--entrypoint",
    "pr",
    "--placement",
    "split",
    "--direction",
    "right",
    "--target-pane",
    targetPane,
    "--env",
    `HERDR_PR_REPO_CWD=${target.cwd || ""}`,
    "--env",
    `HERDR_PR_WORKSPACE_ID=${target.workspaceId}`,
    focus ? "--focus" : "--no-focus",
  ];


  const opened = herdrJson(args);
  const paneId =
    opened.data?.result?.plugin_pane?.pane?.pane_id ||
    opened.data?.result?.pane?.pane_id ||
    null;

  if (!paneId) {
    return {
      skipped: "open-failed",
      status: opened.status,
      stderr: opened.stderr || opened.data,
    };
  }

  rememberPane(target.workspaceId, paneId);
  applyPaneTitle(paneId, snapshot);
  return { paneId, reused: false };
}

function liveNonPrPanes(workspaceId) {
  if (!workspaceId) return [];
  const listed = herdrJson(["pane", "list", "--workspace", workspaceId]);
  return (listed.data?.result?.panes || []).filter((pane) => !isPrPane(pane));
}

function resolveSplitTarget(target) {
  const live = liveNonPrPanes(target.workspaceId);
  if (target.paneId && live.some((pane) => pane.pane_id === target.paneId)) return target.paneId;
  const focused = live.find((pane) => pane.focused);
  const current = herdrJson(["pane", "current"]).data?.result?.pane;
  if (current?.pane_id && !isPrPane(current) && live.some((pane) => pane.pane_id === current.pane_id)) {
    return current.pane_id;
  }
  return focused?.pane_id || live[0]?.pane_id || null;
}


function paneExists(paneId) {
  const got = herdrJson(["pane", "get", paneId]);
  if (!got.ok || !got.data?.result?.pane) {
    forgetPaneById(paneId);
    return false;
  }
  return true;
}

function forgetPaneById(paneId) {
  const panes = loadPanes();
  for (const [workspaceId, entry] of Object.entries(panes.workspaces || {})) {
    if (entry.paneId === paneId) forgetPane(workspaceId);
  }
}

function applyPaneTitle(paneId, snapshot) {
  runHerdr([
    "pane",
    "report-metadata",
    paneId,
    "--source",
    "github-pr",
    "--title",
    paneTitle(snapshot),
  ]);
}
