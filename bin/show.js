#!/usr/bin/env node
import { stdout as output } from "node:process";
import { buildSnapshot, contextTarget, resolveTarget, syncTarget } from "../lib/sync.js";
import { latestSnapshot } from "../lib/store.js";
import { buildTimeline, eventTargetUrl, formatSnapshot } from "../lib/format.js";
import { runCmd } from "../lib/github.js";

const clicked = process.env.HERDR_PLUGIN_CLICKED_URL || "";
const refreshMs = Number(process.env.HERDR_PR_PANE_REFRESH_MS || 60000);
const tabs = ["timeline", "comments", "reviews", "threads"];
let tab = "timeline";
let snapshot = null;
let selected = 0;
let lastFrame = "";
let resizeTimer = null;

function cachedSnapshot(workspaceId, cwd) {
  return latestSnapshot(workspaceId, cwd)?.snapshot || latestSnapshot(workspaceId)?.snapshot || null;
}

function paneWorkspaceId() {
  return process.env.HERDR_PR_WORKSPACE_ID || process.env.HERDR_WORKSPACE_ID || contextTarget().workspaceId;
}

function paneRepoCwd() {
  return process.env.HERDR_PR_REPO_CWD || process.env.HERDR_ACTIVE_PANE_CWD || null;
}

function initialSnapshot() {
  const match = clicked.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/);
  const workspaceId = paneWorkspaceId();
  const cwd = paneRepoCwd();
  if (match && cwd) {
    try {
      return buildSnapshot(cwd, match[3]);
    } catch {
      // fall through to cache
    }
  }
  return cachedSnapshot(workspaceId, cwd);
}

function networkSnapshot() {
  const target = {
    ...resolveTarget(),
    cwd: paneRepoCwd() || resolveTarget().cwd,
    workspaceId: paneWorkspaceId() || resolveTarget().workspaceId,
  };
  const match = clicked.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/);
  if (match && target.cwd) return buildSnapshot(target.cwd, match[3]);
  if (target.cwd) {
    const result = syncTarget(target, { force: true, notifyOnChange: false, openPane: false });
    return result.snapshot || cachedSnapshot(target.workspaceId, target.cwd);
  }
  return cachedSnapshot(target.workspaceId);
}

function paneWidth() {
  return output.columns || Number(process.env.COLUMNS) || 72;
}

function filterSnapshot(full) {
  if (!full?.pr || tab === "timeline") return full;
  const empty = { conversation: [], reviews: [], threads: [] };
  const comments = full.comments || empty;
  if (tab === "comments") return { ...full, comments: { ...empty, conversation: comments.conversation } };
  if (tab === "reviews") return { ...full, comments: { ...empty, reviews: comments.reviews } };
  return { ...full, comments: { ...empty, threads: comments.threads } };
}

function events() {
  return buildTimeline(filterSnapshot(snapshot)?.comments);
}

function clampSelected() {
  const count = events().length;
  if (!count) {
    selected = 0;
    return;
  }
  if (selected < 0) selected = 0;
  if (selected > count - 1) selected = count - 1;
}

function tabBar() {
  return tabs
    .map((name, index) => {
      const mark = `${index + 1}:${name}`;
      return name === tab ? `\x1b[1m[${mark}]\x1b[0m` : mark;
    })
    .join("  ");
}

function render(next = snapshot) {
  snapshot = next;
  clampSelected();
  const frame = `${tabBar()}\n${formatSnapshot(filterSnapshot(snapshot), { width: paneWidth(), selected })}\n\nj/k move  enter open line  1-4 tabs  r refresh  o pr  q quit\n`;
  if (frame === lastFrame) return;
  lastFrame = frame;
  output.write(`\x1b[3J\x1b[2J\x1b[H${frame}`);
}

function openUrl(url) {
  if (!url) return;
  runCmd("xdg-open", [url]);
}

function openSelected() {
  const list = events();
  const event = list[selected];
  if (!event) return;
  openUrl(eventTargetUrl(event, snapshot?.pr));
}

function openPr() {
  const url = snapshot?.pr?.url;
  if (url) openUrl(url);
}

try {
  render(initialSnapshot());
} catch (error) {
  output.write(`GitHub PR pane failed: ${error instanceof Error ? error.message : error}\n`);
}

process.stdin.resume();
process.stdin.on("end", () => {});
process.stdin.on("error", () => {});
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  process.stdin.setEncoding("utf8");
}
process.stdin.on("data", (key) => {
  const text = String(key);
  if (text === "q" || text === "\u0003") process.exit(0);
  if (text === "j" || text === "\x1b[B") {
    selected += 1;
    render(snapshot);
    return;
  }
  if (text === "k" || text === "\x1b[A") {
    selected -= 1;
    render(snapshot);
    return;
  }
  if (text === "\r" || text === "\n") {
    openSelected();
    return;
  }
  if (text >= "1" && text <= "4") {
    tab = tabs[Number(text) - 1];
    selected = 0;
    render(snapshot);
    return;
  }
  if (text === "o") {
    openPr();
    return;
  }
  if (text === "r") {
    try {
      render(networkSnapshot());
    } catch (error) {
      output.write(`\nrefresh failed: ${error instanceof Error ? error.message : error}\n`);
    }
  }
});

output.on("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => render(snapshot), 80);
});

setInterval(() => {
  try {
    render(networkSnapshot());
  } catch {
    // keep the last frame
  }
}, Number.isFinite(refreshMs) && refreshMs > 0 ? refreshMs : 60000);
