import { spawnSync } from "node:child_process";

const PR_FIELDS = [
  "number",
  "title",
  "state",
  "isDraft",
  "url",
  "updatedAt",
  "mergeable",
  "mergeStateStatus",
  "reviewDecision",
  "baseRefName",
  "headRefName",
  "headRefOid",
  "author",
  "statusCheckRollup",
].join(",");

const CHECK_FIELDS = ["name", "bucket", "state", "link"].join(",");

const COMMENTS_QUERY = `
query($owner: String!, $repo: String!, $number: Int!, $commentsCursor: String, $reviewsCursor: String, $threadsCursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      comments(first: 100, after: $commentsCursor) {
        pageInfo { hasNextPage endCursor }
        nodes { id body createdAt updatedAt author { login } url }
      }
      reviews(first: 100, after: $reviewsCursor) {
        pageInfo { hasNextPage endCursor }
        nodes { id state body submittedAt author { login } url }
      }
      reviewThreads(first: 50, after: $threadsCursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          isResolved
          isOutdated
          path
          line
          originalLine
          startLine
          originalStartLine
          comments(first: 50) {
            nodes { id body createdAt updatedAt author { login } url }
          }
        }
      }
    }
  }
}

`;

export function runCmd(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error,
  };
}

export function git(cwd, args) {
  return runCmd("git", ["-C", cwd, ...args]);
}

export function currentBranch(cwd) {
  const inside = git(cwd, ["rev-parse", "--is-inside-work-tree"]);
  if (inside.status !== 0 || inside.stdout.trim() !== "true") return null;
  const branch = git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch.status !== 0) return null;
  const name = branch.stdout.trim();
  if (!name || name === "HEAD") return null;
  return name;
}

export function resolveRepoCwd(cwd) {
  if (!cwd) return null;
  const root = git(cwd, ["rev-parse", "--show-toplevel"]);
  if (root.status !== 0) return null;
  return root.stdout.trim() || null;
}


export function remoteRepo(cwd) {
  const remote = git(cwd, ["remote", "get-url", "origin"]);
  if (remote.status !== 0) return null;
  return parseGithubRemote(remote.stdout.trim());
}

export function parseGithubRemote(url) {
  const text = url.replace(/\.git$/, "");
  const https = text.match(/^https?:\/\/([^/]+)\/([^/]+)\/([^/]+)$/);
  if (https) return { host: https[1], owner: https[2], repo: https[3] };
  const ssh = text.match(/^git@([^:]+):([^/]+)\/([^/]+)$/);
  if (ssh) return { host: ssh[1], owner: ssh[2], repo: ssh[3] };
  return null;
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function ghPrView(cwd, selector) {
  const result = runCmd("gh", ["pr", "view", selector, "--json", PR_FIELDS], { cwd });
  if (!result.stdout.trim()) return null;
  return parseJson(result.stdout);
}

export function ghPrChecks(cwd, selector) {
  const result = runCmd("gh", ["pr", "checks", selector, "--json", CHECK_FIELDS], { cwd });
  const data = parseJson(result.stdout);
  return {
    ok: result.status === 0 && Array.isArray(data),
    checks: Array.isArray(data) ? data : [],
    stderr: result.stderr,
  };
}

export function fetchCommitStatuses(cwd, owner, repo, sha) {
  if (!owner || !repo || !sha) return [];
  const result = runCmd(
    "gh",
    ["api", `repos/${owner}/${repo}/commits/${sha}/status`, "--jq", "."],
    { cwd },
  );
  const data = parseJson(result.stdout);
  if (!data) return [];
  const statuses = Array.isArray(data.statuses) ? data.statuses : [];
  const mapped = statuses.map((item) => {
    const state = String(item.state || "").toLowerCase();
    const bucket = state === "success" ? "pass" : state === "failure" || state === "error" ? "fail" : state === "pending" ? "pending" : "skipping";
    return {
      name: item.context || "status",
      bucket,
      state: item.state || "",
      link: item.target_url || "",
    };
  });
  if (mapped.length) return mapped;
  const combined = String(data.state || "").toLowerCase();
  if (!combined || combined === "pending") return [];
  return [
    {
      name: "status",
      bucket: combined === "success" ? "pass" : combined === "failure" || combined === "error" ? "fail" : "pending",
      state: data.state || "",
      link: "",
    },
  ];
}

export function fetchCheckRuns(cwd, owner, repo, sha) {
  if (!owner || !repo || !sha) return [];
  const result = runCmd("gh", ["api", `repos/${owner}/${repo}/commits/${sha}/check-runs`, "--jq", "."], { cwd });
  const data = parseJson(result.stdout);
  const runs = Array.isArray(data?.check_runs) ? data.check_runs : [];
  return checksFromRollup(
    runs.map((item) => ({
      name: item.name,
      conclusion: item.conclusion,
      status: item.status,
      detailsUrl: item.html_url || item.details_url,
    })),
  );
}

export function mergeChecks(...groups) {
  const byName = new Map();
  for (const group of groups) {
    for (const check of group || []) {
      const name = check?.name || "check";
      const current = byName.get(name);
      if (!current || rankBucket(check.bucket) >= rankBucket(current.bucket)) byName.set(name, check);
    }
  }
  return [...byName.values()];
}

function rankBucket(bucket) {
  if (bucket === "fail") return 3;
  if (bucket === "pending") return 2;
  if (bucket === "pass") return 1;
  return 0;
}

export function resolveChecks(cwd, pr, previousChecks = []) {
  const viewed = ghPrChecks(cwd, String(pr.number));
  const fromRollup = checksFromRollup(pr.statusCheckRollup);
  const repo = pr.repo || {};
  const sha = pr.headRefOid;
  const fromStatus = fetchCommitStatuses(cwd, repo.owner, repo.repo, sha);
  const fromRuns = fetchCheckRuns(cwd, repo.owner, repo.repo, sha);
  const merged = mergeChecks(viewed.checks, fromRollup, fromStatus, fromRuns);
  if (merged.length) return merged;
  return Array.isArray(previousChecks) ? previousChecks : [];
}


export function ghGraphql(cwd, variables) {
  const args = ["api", "graphql", "-f", `query=${COMMENTS_QUERY}`];
  for (const [key, value] of Object.entries(variables)) {
    if (value == null) continue;
    if (typeof value === "number") args.push("-F", `${key}=${value}`);
    else args.push("-f", `${key}=${value}`);
  }
  const result = runCmd("gh", args, { cwd });
  return parseJson(result.stdout);
}

export function appendUnique(target, nodes) {
  const seen = new Set(target.map((item) => item?.id).filter(Boolean));
  for (const node of nodes || []) {
    if (node?.id && seen.has(node.id)) continue;
    if (node?.id) seen.add(node.id);
    target.push(node);
  }
}


export function fetchComments(cwd, owner, repo, number) {
  const conversation = [];
  const reviews = [];
  const threads = [];
  let commentsCursor;
  let reviewsCursor;
  let threadsCursor;

  for (let page = 0; page < 10; page += 1) {
    const payload = ghGraphql(cwd, {
      owner,
      repo,
      number,
      commentsCursor,
      reviewsCursor,
      threadsCursor,
    });
    if (!payload || payload.errors) break;
    const pr = payload.data?.repository?.pullRequest;
    if (!pr) break;

    // GraphQL `after: null` is the first page. Once a connection is exhausted,
    // later pages would re-fetch that first page unless we skip it.
    if (page === 0 || commentsCursor) appendUnique(conversation, pr.comments?.nodes);
    if (page === 0 || reviewsCursor) appendUnique(reviews, pr.reviews?.nodes);
    if (page === 0 || threadsCursor) appendUnique(threads, pr.reviewThreads?.nodes);

    commentsCursor = pr.comments?.pageInfo?.hasNextPage ? pr.comments.pageInfo.endCursor : null;
    reviewsCursor = pr.reviews?.pageInfo?.hasNextPage ? pr.reviews.pageInfo.endCursor : null;
    threadsCursor = pr.reviewThreads?.pageInfo?.hasNextPage ? pr.reviewThreads.pageInfo.endCursor : null;
    if (!commentsCursor && !reviewsCursor && !threadsCursor) break;
  }


  return { conversation, reviews, threads };
}

export function rollupChecks(checks) {
  if (!checks.length) return "none";
  const buckets = new Set(checks.map((check) => check.bucket));
  if (buckets.has("fail") || buckets.has("cancel")) return "fail";
  if (buckets.has("pending")) return "pending";
  return "pass";
}

export function normalizePrState(pr) {
  if (pr.state === "MERGED") return "MERGED";
  if (pr.state === "CLOSED") return "CLOSED";
  if (pr.isDraft) return "DRAFT";
  return "OPEN";
}

export function composePrLabel(pr, checks) {
  const number = `#${pr.number}`;
  const state = normalizePrState(pr);
  const ci = rollupChecks(checks);
  const symbol = ci === "pass" ? "✓" : ci === "fail" ? "✗" : ci === "pending" ? "●" : "";
  const lifecycle = state === "MERGED" ? "◆" : state === "CLOSED" ? "⊘" : state === "DRAFT" ? "draft" : "";
  return [number, lifecycle, symbol].filter(Boolean).join(" ");
}

export function composeStatusLabel(pr, checks) {
  const state = normalizePrState(pr).toLowerCase();
  const ci = rollupChecks(checks);
  return ci === "none" ? state : `${state} · ${ci}`;
}

export function checksFromRollup(rollup) {
  if (!Array.isArray(rollup)) return [];
  return rollup.map((item) => {
    const conclusion = String(item.conclusion || "").toUpperCase();
    const status = String(item.status || item.state || "").toUpperCase();
    let bucket = "pending";
    if (conclusion === "SUCCESS" || status === "SUCCESS") bucket = "pass";
    else if (["FAILURE", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE", "ERROR"].includes(conclusion)) bucket = "fail";
    else if (["CANCELLED", "CANCELED", "SKIPPED", "NEUTRAL", "STALE"].includes(conclusion)) bucket = "skipping";
    else if (status === "COMPLETED" && !conclusion) bucket = "pass";
    return {
      name: item.name || item.context || "check",
      bucket,
      state: item.conclusion || item.status || item.state || "",
      link: item.detailsUrl || item.targetUrl || item.link || "",
    };
  });
}


export function commentCounts(comments) {
  const unresolved = comments.threads.filter((thread) => !thread.isResolved).length;
  const conversation = comments.conversation.length;
  const reviews = comments.reviews.filter((review) => (review.body || "").trim()).length;
  return { conversation, reviews, unresolved, total: conversation + reviews + comments.threads.length };
}

export function composeCommentLabel(counts) {
  if (counts.unresolved > 0) return `${counts.unresolved} unresolved`;
  if (counts.total === 0) return "0 comments";
  return `${counts.total} comments`;
}

export function snapshotIdentity(pr) {
  const commentIds = [];
  for (const item of pr.comments.conversation) commentIds.push(item.id);
  for (const item of pr.comments.reviews) commentIds.push(`${item.id}:${item.state}`);
  for (const thread of pr.comments.threads) {
    commentIds.push(`${thread.id}:${thread.isResolved ? "r" : "o"}`);
    for (const item of thread.comments?.nodes || []) commentIds.push(item.id);
  }
  return {
    number: pr.number,
    updatedAt: pr.updatedAt,
    headSha: pr.headRefOid,
    reviewDecision: pr.reviewDecision || "",
    checks: pr.checksStatus,
    comments: commentIds.sort().join(","),
  };
}
