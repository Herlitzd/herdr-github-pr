import {
  commentCounts,
  composeCommentLabel,
  composePrLabel,
  composeStatusLabel,
  currentBranch,
  fetchComments,
  ghPrView,
  normalizePrState,
  remoteRepo,
  resolveChecks,
  resolveRepoCwd,
  rollupChecks,
  snapshotIdentity,
} from "./github.js";
import { herdrJson, parseJsonEnv, runHerdr } from "./herdr.js";
import { latestSnapshot, markSeen, previousIdentity, storeSnapshot } from "./store.js";
import { formatToast } from "./format.js";
import { ensurePrPane, isPrPane } from "./pane.js";
import { lastCheckMs, recordCheck, throttleElapsed } from "./throttle.js";

const SOURCE = "github-pr";

export function resolvePaneCwd(pane) {
  return pane?.foreground_cwd || pane?.cwd || null;
}

export function contextTarget() {
  const context = parseJsonEnv("HERDR_PLUGIN_CONTEXT_JSON");
  const event = parseJsonEnv("HERDR_PLUGIN_EVENT_JSON");
  const pane = context.pane || context.focused_pane || event.data?.pane || null;
  const paneId =
    pane?.pane_id ||
    context.pane_id ||
    context.focused_pane_id ||
    event.data?.pane_id ||
    process.env.HERDR_PANE_ID ||
    null;
  const workspaceId =
    pane?.workspace_id ||
    context.workspace_id ||
    event.data?.workspace_id ||
    process.env.HERDR_WORKSPACE_ID ||
    null;
  // workspace_cwd is often $HOME / identity_cwd, not the pane's git checkout.
  const cwd = resolvePaneCwd(pane) || context.focused_pane_cwd || event.data?.cwd || null;
  return { context, event, pane, paneId, workspaceId, cwd };
}

export function resolveTarget(explicitPaneId) {
  const fromEnv = contextTarget();
  const paneId = explicitPaneId || fromEnv.paneId;
  if (paneId) {
    const got = herdrJson(["pane", "get", paneId]);
    return finishTarget(fromEnv, got.data?.result?.pane || fromEnv.pane, paneId);
  }
  const current = herdrJson(["pane", "current"]);
  const pane = current.data?.result?.pane || fromEnv.pane;
  return finishTarget(fromEnv, pane, pane?.pane_id || fromEnv.paneId);
}

function finishTarget(fromEnv, pane, paneId) {
  let resolved = pane;
  let cwd = resolvePaneCwd(pane) || fromEnv.cwd;
  if (isPrPane(pane) && pane?.workspace_id) {
    const listed = herdrJson(["pane", "list", "--workspace", pane.workspace_id]);
    const other = (listed.data?.result?.panes || []).find((item) => !isPrPane(item));
    if (other) {
      resolved = other;
      cwd = process.env.HERDR_PR_REPO_CWD || resolvePaneCwd(other) || cwd;
    }
  }
  return {
    ...fromEnv,
    pane: resolved,
    paneId: resolved?.pane_id || paneId,
    workspaceId: resolved?.workspace_id || fromEnv.workspaceId,
    cwd: resolveRepoPath(cwd),
  };
}

function resolveRepoPath(cwd) {
  return resolveRepoCwd(cwd) || cwd || null;
}


function report(kind, id, tokens) {
  if (!id) return;
  const args = [kind, "report-metadata", id, "--source", SOURCE];
  for (const [name, value] of Object.entries(tokens)) {
    if (value == null || value === "") args.push("--clear-token", name);
    else args.push("--token", `${name}=${value}`);
  }
  runHerdr(args);
}

function applyTokens(target, snapshot) {
  const tokens = snapshot.pr
    ? {
        pr: snapshot.labels.pr,
        pr_comments: snapshot.labels.comments,
        pr_review: snapshot.labels.review,
        pr_status: snapshot.labels.status,
      }
    : { pr: "", pr_comments: "", pr_review: "", pr_status: "" };
  if (target.paneId) report("pane", target.paneId, tokens);
  if (target.workspaceId) report("workspace", target.workspaceId, tokens);
}

function notify(title, body) {
  runHerdr(["notification", "show", title, "--body", body, "--sound", "request"]);
}

export function buildSnapshot(cwd, selector = "HEAD", previous = null) {
  const repo = remoteRepo(cwd);
  const branch = currentBranch(cwd);
  if (!branch && selector === "HEAD") {
    return { error: null, message: "Not a git branch.", pr: null };
  }
  const pr = ghPrView(cwd, selector === "HEAD" ? branch : selector);
  if (!pr) {
    return { error: null, message: "No pull request for the current branch.", pr: null };
  }
  const repoInfo = repo || {
    host: "github.com",
    owner: pr.url?.split("/")[3] || "unknown",
    repo: pr.url?.split("/")[4] || "unknown",
  };
  const checks = resolveChecks(
    cwd,
    { ...pr, repo: repoInfo },
    previous?.pr?.checks || [],
  );
  const comments = fetchComments(cwd, repoInfo.owner, repoInfo.repo, pr.number);
  const counts = commentCounts(comments);
  const normalized = {
    ...pr,
    repo: repoInfo,
    state: normalizePrState(pr),
    checks,
    checksStatus: rollupChecks(checks),
    comments,
  };
  return {
    pr: normalized,
    comments,
    counts,
    labels: {
      pr: composePrLabel(normalized, checks),
      comments: composeCommentLabel(counts),
      review: (pr.reviewDecision || "none").toLowerCase().replaceAll("_", " "),
      status: composeStatusLabel(normalized, checks),
    },
    identity: snapshotIdentity(normalized),
  };
}

export function syncTarget(target, { force = false, notifyOnChange = true, openPane } = {}) {
  if (!target.cwd) return { skipped: "no-cwd", target };
  const key = `${target.paneId || target.workspaceId || "unknown"}:${target.cwd}`;
  const now = Date.now();
  if (!force && !throttleElapsed(lastCheckMs(key), now)) return { skipped: "throttle", target };
  recordCheck(key, now);

  const previousCache = latestSnapshot(target.workspaceId, target.cwd);
  if (target.paneId && previousCache?.snapshot?.pr) {
    report("pane", target.paneId, {
      pr: `${previousCache.snapshot.labels.pr.replace(/[✓✗●◆⊘]/g, "").trim()} ⟳`,
    });
  }

  const snapshot = buildSnapshot(target.cwd, "HEAD", previousCache?.snapshot);
  if (!snapshot.pr && previousCache?.snapshot?.pr) {
    applyTokens(target, previousCache.snapshot);
    return { snapshot: previousCache.snapshot, target, skipped: "keep-cache" };
  }
  storeSnapshot(target.workspaceId, target.cwd, snapshot);
  applyTokens(target, snapshot);


  const shouldOpen = openPane ?? false;
  let pane = null;
  if (shouldOpen && snapshot.pr) {
    pane = ensurePrPane(target, { snapshot, focus: false });
  }


  if (snapshot.pr && notifyOnChange) {
    const prKey = `${snapshot.pr.repo.owner}/${snapshot.pr.repo.repo}#${snapshot.pr.number}`;
    const previous = previousIdentity(prKey);
    const toast = formatToast(previous, snapshot);
    markSeen(prKey, snapshot.identity);
    if (toast) notify(`PR #${snapshot.pr.number}`, toast);
  }

  return { snapshot, target, pane };
}

export function syncFromInvocation({ force = false } = {}) {
  return syncTarget(resolveTarget(process.argv[2]), { force });
}
