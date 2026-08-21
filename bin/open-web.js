#!/usr/bin/env node
import { resolveTarget, buildSnapshot } from "../lib/sync.js";
import { runCmd } from "../lib/github.js";
import { runHerdr } from "../lib/herdr.js";

try {
  const target = resolveTarget(process.argv[2]);
  if (!target.cwd) {
    console.error("[github-pr] no pane cwd");
    process.exit(0);
  }
  const snapshot = buildSnapshot(target.cwd);
  if (!snapshot.pr) {
    console.error(`[github-pr] ${snapshot.message || "no pr"}`);
    process.exit(0);
  }
  const opened = runCmd("gh", ["pr", "view", String(snapshot.pr.number), "--web"], { cwd: target.cwd });
  if (opened.status === 0) process.exit(0);
  runHerdr(["notification", "show", "PR ready", "--body", snapshot.pr.url]);
  console.error(`[github-pr] could not open a browser, PR URL: ${snapshot.pr.url}`);
} catch (error) {
  console.error(`[github-pr] open-web failed: ${error instanceof Error ? error.message : error}`);
}
