import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function stateDir() {
  return process.env.HERDR_PLUGIN_STATE_DIR || join(process.cwd(), ".state");
}

export function cachePath() {
  return join(stateDir(), "prs.json");
}

export function seenPath() {
  return join(stateDir(), "seen.json");
}

export function panesPath() {
  return join(stateDir(), "panes.json");
}


function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

export function loadCache() {
  return readJson(cachePath(), { workspaces: {} });
}

export function saveCache(cache) {
  mkdirSync(stateDir(), { recursive: true });
  writeFileSync(cachePath(), `${JSON.stringify(cache, null, 2)}\n`, "utf8");
}

export function loadSeen() {
  return readJson(seenPath(), { comments: {} });
}

export function saveSeen(seen) {
  mkdirSync(stateDir(), { recursive: true });
  writeFileSync(seenPath(), `${JSON.stringify(seen, null, 2)}\n`, "utf8");
}

export function workspaceKey(workspaceId, cwd) {
  return `${workspaceId || "unknown"}::${cwd}`;
}

export function storeSnapshot(workspaceId, cwd, snapshot) {
  const cache = loadCache();
  cache.workspaces[workspaceKey(workspaceId, cwd)] = {
    workspaceId,
    cwd,
    fetchedAt: new Date().toISOString(),
    snapshot,
  };
  saveCache(cache);
}

export function latestSnapshot(workspaceId, cwd) {
  const cache = loadCache();
  if (cwd) {
    const exact = cache.workspaces[workspaceKey(workspaceId, cwd)];
    if (exact) return exact;
  }
  const matches = Object.values(cache.workspaces).filter((entry) => entry.workspaceId === workspaceId);
  matches.sort((a, b) => String(b.fetchedAt).localeCompare(String(a.fetchedAt)));
  return matches[0] || null;
}

export function markSeen(prKey, identity) {
  const seen = loadSeen();
  seen.comments[prKey] = identity;
  saveSeen(seen);
}

export function previousIdentity(prKey) {
  return loadSeen().comments[prKey] || null;
}

export function loadPanes() {
  return readJson(panesPath(), { workspaces: {} });
}

export function savePanes(panes) {
  mkdirSync(stateDir(), { recursive: true });
  writeFileSync(panesPath(), `${JSON.stringify(panes, null, 2)}\n`, "utf8");
}

export function rememberPane(workspaceId, paneId) {
  if (!workspaceId || !paneId) return;
  const panes = loadPanes();
  panes.workspaces[workspaceId] = { paneId, updatedAt: new Date().toISOString() };
  savePanes(panes);
}

export function forgetPane(workspaceId) {
  if (!workspaceId) return;
  const panes = loadPanes();
  delete panes.workspaces[workspaceId];
  savePanes(panes);
}


export function cacheExists() {
  return existsSync(cachePath());
}
