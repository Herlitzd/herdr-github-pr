import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  appendUnique,
  commentCounts,
  composeCommentLabel,
  composePrLabel,
  composeStatusLabel,
  checksFromRollup,
  mergeChecks,
  parseGithubRemote,
  rollupChecks,
  snapshotIdentity,
} from "../lib/github.js";
import { buildTimeline, eventTargetUrl, formatSnapshot, formatToast, presentMerge, presentReview, renderMarkdown, shortPath, threadLine } from "../lib/format.js";
import { lastCheckMs, recordCheck, throttleElapsed } from "../lib/throttle.js";
import { contextTarget } from "../lib/sync.js";
import { paneTitle, shouldOpenPrPane, isPrPane } from "../lib/pane.js";


test("parseGithubRemote accepts https and ssh", () => {
  assert.deepEqual(parseGithubRemote("https://github.com/acme/app.git"), {
    host: "github.com",
    owner: "acme",
    repo: "app",
  });
  assert.deepEqual(parseGithubRemote("git@github.com:acme/app.git"), {
    host: "github.com",
    owner: "acme",
    repo: "app",
  });
});

test("appendUnique drops repeated GraphQL pages", () => {
  const items = [{ id: "c1", body: "one" }];
  appendUnique(items, [{ id: "c1", body: "one again" }, { id: "c2", body: "two" }]);
  assert.deepEqual(items.map((item) => item.id), ["c1", "c2"]);
});


test("rollupChecks prefers fail then pending", () => {
  assert.equal(rollupChecks([]), "none");
  assert.equal(rollupChecks([{ bucket: "pass" }, { bucket: "skipping" }]), "pass");
  assert.equal(rollupChecks([{ bucket: "pass" }, { bucket: "pending" }]), "pending");
  assert.equal(rollupChecks([{ bucket: "pending" }, { bucket: "fail" }]), "fail");
});

test("composePrLabel encodes state and CI", () => {
  assert.equal(composePrLabel({ number: 12, state: "OPEN", isDraft: false }, []), "#12");
  assert.equal(composePrLabel({ number: 12, state: "OPEN", isDraft: true }, [{ bucket: "pending" }]), "#12 draft ●");
  assert.equal(composePrLabel({ number: 12, state: "MERGED" }, []), "#12 ◆");
  assert.equal(composePrLabel({ number: 12, state: "CLOSED" }, []), "#12 ⊘");
  assert.equal(composePrLabel({ number: 12, state: "OPEN" }, [{ bucket: "pass" }]), "#12 ✓");
  assert.equal(composePrLabel({ number: 12, state: "CLOSED" }, [{ bucket: "pass" }]), "#12 ⊘ ✓");
  assert.equal(composePrLabel({ number: 12, state: "MERGED" }, [{ bucket: "fail" }]), "#12 ◆ ✗");
  assert.equal(composeStatusLabel({ number: 12, state: "CLOSED" }, [{ bucket: "pass" }]), "closed · pass");
});

test("checksFromRollup maps GitHub statusCheckRollup", () => {
  assert.deepEqual(
    checksFromRollup([{ name: "test", conclusion: "SUCCESS", status: "COMPLETED", detailsUrl: "https://example" }]),
    [{ name: "test", bucket: "pass", state: "SUCCESS", link: "https://example" }],
  );
  assert.equal(checksFromRollup([{ conclusion: "FAILURE" }])[0].bucket, "fail");
  assert.equal(checksFromRollup([{ status: "IN_PROGRESS" }])[0].bucket, "pending");
});

test("mergeChecks keeps the worse bucket per name", () => {
  const merged = mergeChecks(
    [{ name: "test", bucket: "pass" }],
    [{ name: "test", bucket: "fail" }, { name: "lint", bucket: "pending" }],
  );
  assert.equal(merged.find((item) => item.name === "test").bucket, "fail");
  assert.equal(merged.find((item) => item.name === "lint").bucket, "pending");
});

test("empty live checks keep the previous CI snapshot", () => {
  const previous = [{ name: "test", bucket: "pass", state: "SUCCESS" }];
  const resolved = mergeChecks([], [], previous);
  assert.deepEqual(resolved, previous);
});


test("comment labels and identity change when threads resolve", () => {
  const open = {
    number: 3,
    updatedAt: "t",
    headRefOid: "abc",
    reviewDecision: "",
    checksStatus: "pending",
    comments: {
      conversation: [{ id: "c1" }],
      reviews: [{ id: "r1", state: "COMMENTED" }],
      threads: [{ id: "th1", isResolved: false, comments: { nodes: [{ id: "tc1" }] } }],
    },
  };
  const resolved = {
    ...open,
    comments: {
      ...open.comments,
      threads: [{ id: "th1", isResolved: true, comments: { nodes: [{ id: "tc1" }] } }],
    },
  };
  assert.equal(composeCommentLabel(commentCounts(open.comments)), "1 unresolved");
  assert.equal(composeCommentLabel(commentCounts(resolved.comments)), "2 comments");
  assert.notEqual(snapshotIdentity(open).comments, snapshotIdentity(resolved).comments);
});

test("formatSnapshot and toast stay compact", () => {
  const snapshot = {
    pr: {
      number: 9,
      title: "Add sync",
      url: "https://github.com/acme/app/pull/9",
      state: "OPEN",
      isDraft: false,
      headRefName: "feat",
      baseRefName: "main",
      author: { login: "ada" },
      checksStatus: "fail",
      reviewDecision: "CHANGES_REQUESTED",
      mergeable: "MERGEABLE",
      mergeStateStatus: "BLOCKED",
      updatedAt: "2026-08-17T01:00:00Z",
      headRefOid: "deadbeefcafebabe",
      repo: { owner: "acme", repo: "app" },
      checks: [{ name: "ci", bucket: "fail" }],
    },
    comments: {
      conversation: [
        { author: { login: "bev" }, createdAt: "2026-08-17T01:02:00Z", body: "please fix ci" },
        { author: { login: "ada" }, createdAt: "2026-08-17T01:04:00Z", body: "working on it" },
      ],
      reviews: [{ author: { login: "cam" }, state: "CHANGES_REQUESTED", submittedAt: "2026-08-17T01:03:00Z", body: "nits" }],
      threads: [
        {
          isResolved: false,
          isOutdated: false,
          path: "lib/sync.js",
          line: 10,
          comments: { nodes: [{ author: { login: "cam" }, body: "extract this" }] },
        },
      ],
    },
    counts: { conversation: 1, reviews: 1, unresolved: 1, total: 3 },
    identity: { checks: "fail", reviewDecision: "CHANGES_REQUESTED", comments: "new" },
  };
  const text = formatSnapshot(snapshot).replace(/\x1b\[[0-9;]*m/g, "");
  assert.match(text, /please fix ci/);
  assert.match(text, /Activity/);
  assert.match(text, /#9/);
  assert.match(text, /Add sync/);
  assert.match(text, /\[Open\]/);
  assert.match(text, /\[CI ✗\]/);
  assert.match(text, /\[Changes requested\]/);
  assert.match(text, /\[Blocked\]/);
  assert.match(text, /fail\s+ci/);
  assert.match(text, /sync\.js:10/);
  assert.ok(text.indexOf("please fix ci") < text.indexOf("nits"));
  assert.ok(text.indexOf("nits") < text.indexOf("working on it"));
  assert.equal(presentReview("REVIEW_REQUIRED").label, "Needs review");
  assert.equal(presentMerge({ state: "OPEN", mergeable: "MERGEABLE", mergeStateStatus: "CLEAN" }).label, "Mergeable");
  assert.equal(
    formatToast({ checks: "pending", reviewDecision: "", comments: "old", number: 9 }, snapshot),
    "checks fail · review changes requested · 1 unresolved",
  );
  assert.equal(formatToast(null, snapshot), null);

});

test("renderMarkdown styles GitHub comment markup", () => {
  const text = renderMarkdown(
    [
      "## 進捗",
      "",
      "- `800 / 2,500 行`",
      "",
      "| 状態 | 確認 |",
      "| --- | --- |",
      "| 実行中 | <img src=\"x\"> |",
      "",
      "```ts",
      "const next = 1;",
      "```",
      "",
      "> 処理開始位置",
      "",
      "see [PR](https://github.com/acme/app/pull/9) and **bold**",
    ].join("\n"),
    { width: 60, indent: "" },
  )
    .join("\n")
    .replace(/\x1b\[[0-9;]*m/g, "");
  assert.match(text, /進捗/);
  assert.match(text, /• 800 \/ 2,500 行/);
  assert.match(text, /状態 │ 確認/);
  assert.match(text, /\[image\]/);
  assert.match(text, /┌ ts/);
  assert.match(text, /│ const next = 1;/);
  assert.match(text, /│ 処理開始位置/);
  assert.match(text, /see PR and bold/);
});

test("buildTimeline is oldest-first across comment kinds", () => {
  const events = buildTimeline({
    conversation: [{ createdAt: "2026-08-17T02:00:00Z", body: "later" }],
    reviews: [{ submittedAt: "2026-08-17T01:00:00Z", state: "APPROVED", body: "lgtm" }],
    threads: [{ comments: { nodes: [{ createdAt: "2026-08-17T01:30:00Z" }] } }],
  });
  assert.deepEqual(events.map((event) => event.kind), ["review", "thread", "comment"]);
});

test("thread locations use basename and comment URL", () => {
  assert.equal(shortPath("tensaku-admin/src/pages/examinationBatchImport/index.tsx", 376), "index.tsx:376");
  assert.equal(threadLine({ line: null, originalLine: 12 }), 12);
  const url = eventTargetUrl(
    { kind: "thread", thread: { comments: { nodes: [{ url: "https://github.com/acme/app/pull/9#discussion_r1" }] } } },
    { url: "https://github.com/acme/app/pull/9" },
  );
  assert.equal(url, "https://github.com/acme/app/pull/9#discussion_r1");
});





test("disk throttle records elapsed windows", () => {
  const dir = mkdtempSync(join(tmpdir(), "herdr-github-pr-"));
  process.env.HERDR_PLUGIN_STATE_DIR = dir;
  try {
    assert.equal(lastCheckMs("p1"), 0);
    recordCheck("p1", 1000);
    assert.equal(lastCheckMs("p1"), 1000);
    assert.equal(throttleElapsed(1000, 2000, 30000), false);
    assert.equal(throttleElapsed(1000, 32000, 30000), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.HERDR_PLUGIN_STATE_DIR;
  }
});

test("contextTarget prefers focused pane cwd over workspace cwd", () => {
  process.env.HERDR_PLUGIN_CONTEXT_JSON = JSON.stringify({
    focused_pane_id: "w1:p2",
    focused_pane_cwd: "/tmp/repo",
    workspace_id: "w1",
    workspace_cwd: "/home/user",
  });
  try {
    const target = contextTarget();
    assert.equal(target.paneId, "w1:p2");
    assert.equal(target.workspaceId, "w1");
    assert.equal(target.cwd, "/tmp/repo");
  } finally {
    delete process.env.HERDR_PLUGIN_CONTEXT_JSON;
  }
});

test("PR pane stays open for comments and names itself", () => {
  assert.equal(shouldOpenPrPane("pr"), false);
  assert.equal(shouldOpenPrPane("refresh"), true);
  assert.equal(paneTitle({ pr: { number: 871 } }), "GitHub PR #871");
  assert.equal(isPrPane({ label: "GitHub PR" }), true);
  assert.equal(isPrPane({ title: "GitHub PR #871" }), true);
  assert.equal(isPrPane({ terminal_title: "π tensakit" }), false);
});


test("contextTarget does not fall back to workspace_cwd", () => {
  process.env.HERDR_PLUGIN_CONTEXT_JSON = JSON.stringify({
    workspace_id: "w2",
    workspace_cwd: "/home/user",
  });
  process.env.HERDR_PLUGIN_EVENT_JSON = JSON.stringify({
    data: { pane_id: "w2:p1", workspace_id: "w2" },
  });
  try {
    const target = contextTarget();
    assert.equal(target.paneId, "w2:p1");
    assert.equal(target.workspaceId, "w2");
    assert.equal(target.cwd, null);
  } finally {
    delete process.env.HERDR_PLUGIN_CONTEXT_JSON;
    delete process.env.HERDR_PLUGIN_EVENT_JSON;
  }
});

