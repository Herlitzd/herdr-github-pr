const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const FG = {
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

function paint(color, text) {
  return `${color}${text}${RESET}`;
}

// OSC 8 hyperlink; terminals without support just show the text.
export function hyperlink(url, text) {
  return url ? `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\` : text;
}

function visibleLength(text) {
  return String(text || "")
    .replace(/\x1b\]8;;[^\x1b]*\x1b\\/g, "")
    .replace(/\x1b\[[0-9;]*m/g, "").length;
}

function wrapPlain(text, width, indent) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (visibleLength(next) <= width) line = next;
    else {
      if (line) lines.push(`${indent}${line}`);
      line = word;
    }
  }
  if (line) lines.push(`${indent}${line}`);
  return lines;
}

function styleInline(text) {
  return String(text || "")
    .replace(/!\[([^\]]*)]\([^)]+\)/g, (_, alt) => paint(FG.gray, `[image${alt ? `: ${alt}` : ""}]`))
    .replace(/<img\b[^>]*>/gi, paint(FG.gray, "[image]"))
    .replace(/\[([^\]]+)]\((https?:[^)]+)\)/g, (_, label) => paint(FG.cyan, label))
    .replace(/`([^`]+)`/g, (_, code) => paint(FG.yellow, code))
    .replace(/\*\*([^*]+)\*\*/g, (_, value) => `${BOLD}${value}${RESET}`)
    .replace(/__([^_]+)__/g, (_, value) => `${BOLD}${value}${RESET}`)
    .replace(/(^|[^\w*])\*([^*\n]+)\*(?!\*)/g, (_, pre, value) => `${pre}${DIM}${value}${RESET}`)
    .replace(/(^|[^\w_])_([^_\n]+)_(?!_)/g, (_, pre, value) => `${pre}${DIM}${value}${RESET}`)
    .replace(/~~([^~]+)~~/g, (_, value) => paint(DIM, value));
}

export function renderMarkdown(text, { width = 72, indent = "    " } = {}) {
  const source = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!source) return [];
  const lines = [];
  const raw = source.split("\n");
  let i = 0;
  let inCode = false;
  let codeLang = "";

  while (i < raw.length) {
    const line = raw[i];

    if (line.trim().startsWith("```")) {
      if (!inCode) {
        inCode = true;
        codeLang = line.trim().slice(3).trim();
        lines.push(`${indent}${paint(FG.gray, codeLang ? `┌ ${codeLang}` : "┌")}`);
      } else {
        inCode = false;
        codeLang = "";
        lines.push(`${indent}${paint(FG.gray, "└")}`);
      }
      i += 1;
      continue;
    }

    if (inCode) {
      lines.push(`${indent}${paint(FG.yellow, `│ ${line}`)}`);
      i += 1;
      continue;
    }

    if (/^\s*\|.+\|\s*$/.test(line) && i + 1 < raw.length && /^\s*\|?\s*:?-{3,}/.test(raw[i + 1])) {
      const header = line.split("|").slice(1, -1).map((cell) => cell.trim());
      lines.push(`${indent}${header.map((cell) => paint(BOLD, styleInline(cell))).join(paint(FG.gray, " │ "))}`);
      i += 2;
      while (i < raw.length && /^\s*\|.+\|\s*$/.test(raw[i])) {
        const cells = raw[i].split("|").slice(1, -1).map((cell) => cell.trim());
        lines.push(`${indent}${cells.map((cell) => styleInline(cell)).join(paint(FG.gray, " │ "))}`);
        i += 1;
      }
      continue;
    }

    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+)$/);
    if (heading) {
      const title = styleInline(heading[2]);
      lines.push(`${indent}${BOLD}${title}${RESET}`);
      i += 1;
      continue;
    }

    const quote = line.match(/^\s{0,3}>\s?(.*)$/);
    if (quote) {
      lines.push(...wrapPlain(styleInline(quote[1]), Math.max(16, width - 2), `${indent}${paint(FG.gray, "│ ")}`));
      i += 1;
      continue;
    }

    const bullet = line.match(/^\s{0,3}[-*+]\s+(.+)$/);
    if (bullet) {
      const body = wrapPlain(styleInline(bullet[1]), Math.max(16, width - 2), `${indent}  `);
      if (body.length) {
        body[0] = body[0].replace(`${indent}  `, `${indent}${paint(FG.gray, "•")} `);
        lines.push(...body);
      }
      i += 1;
      continue;
    }

    const numbered = line.match(/^\s{0,3}(\d+)[.)]\s+(.+)$/);
    if (numbered) {
      const marker = `${numbered[1]}. `;
      const body = wrapPlain(styleInline(numbered[2]), Math.max(16, width - marker.length), `${indent}${" ".repeat(marker.length)}`);
      if (body.length) {
        body[0] = `${indent}${paint(FG.gray, marker)}${body[0].slice(indent.length + marker.length)}`;
        lines.push(...body);
      }
      i += 1;
      continue;
    }

    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      lines.push(`${indent}${paint(FG.gray, "┄".repeat(Math.min(32, width)))}`);
      i += 1;
      continue;
    }

    if (!line.trim()) {
      if (lines.length && lines.at(-1) !== "") lines.push("");
      i += 1;
      continue;
    }

    lines.push(...wrapPlain(styleInline(line), width, indent));
    i += 1;
  }

  return lines.filter((line, index, all) => line !== "" || all[index - 1] !== "");
}


function login(author) {
  return author?.login || "unknown";
}

function when(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.replace("T", " ").replace(/Z$/, " UTC");
  const delta = Date.now() - date.getTime();
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (delta < minute) return "just now";
  if (delta < hour) return `${Math.floor(delta / minute)}m ago`;
  if (delta < day) return `${Math.floor(delta / hour)}h ago`;
  if (delta < 14 * day) return `${Math.floor(delta / day)}d ago`;
  return date.toISOString().slice(0, 10);
}

function reviewLabel(decision) {
  if (!decision) return "none";
  return String(decision).toLowerCase().replaceAll("_", " ");
}

export function presentReview(decision) {
  const value = String(decision || "").toUpperCase();
  if (value === "APPROVED") return { label: "Approved", color: FG.green };
  if (value === "CHANGES_REQUESTED") return { label: "Changes requested", color: FG.red };
  if (value === "REVIEW_REQUIRED") return { label: "Needs review", color: FG.yellow };
  return null;
}

export function presentChecks(status) {
  if (status === "pass") return { label: "CI ✓", color: FG.green };
  if (status === "fail") return { label: "CI ✗", color: FG.red };
  if (status === "pending") return { label: "CI ●", color: FG.yellow };
  return null;
}

export function presentMerge(pr) {
  const mergeable = String(pr.mergeable || "").toUpperCase();
  const state = String(pr.mergeStateStatus || "").toUpperCase();
  const lifecycle = String(pr.state || "").toUpperCase();
  if (lifecycle === "MERGED" || lifecycle === "CLOSED") return null;
  if (mergeable === "CONFLICTING" || state === "DIRTY") return { label: "Conflicts", color: FG.red };
  if (state === "BEHIND") return { label: "Behind", color: FG.yellow };
  if (state === "BLOCKED") return { label: "Blocked", color: FG.yellow };
  if (mergeable === "MERGEABLE" && (state === "CLEAN" || state === "HAS_HOOKS" || !state)) {
    return { label: "Mergeable", color: FG.green };
  }
  if (state === "UNSTABLE") return { label: "Unstable", color: FG.yellow };
  return null;
}


export function presentLifecycle(pr) {
  const state = String(pr.state || "").toUpperCase();
  if (state === "MERGED") return { label: "Merged", color: FG.magenta };
  if (state === "CLOSED") return { label: "Closed", color: FG.gray };
  if (pr.isDraft) return { label: "Draft", color: FG.yellow };
  return { label: "Open", color: FG.green };
}

function chip(presented) {
  return paint(presented.color, `${BOLD}[${presented.label}]${RESET}${presented.color}`);
}

function rule(width) {
  return paint(FG.gray, "─".repeat(Math.max(12, Math.min(width, 72))));
}

function hairline(width, indent = "  ") {
  return paint(DIM + FG.gray, `${indent}${"┄".repeat(Math.max(8, Math.min(width - indent.length, 48)))}`);
}

function section(title, count, extra, width) {
  const suffix = extra ? `  ${paint(DIM, extra)}` : "";
  return `${rule(width)}\n${BOLD}${title}${RESET}${count == null ? "" : paint(FG.gray, `  ${count}`)}${suffix}`;
}


function sortOldest(items, field) {
  return [...items].sort((a, b) => String(a[field] || "\uffff").localeCompare(String(b[field] || "\uffff")));
}

function threadStart(thread) {
  const comments = thread.comments?.nodes || [];
  return comments[0]?.createdAt || comments[0]?.updatedAt || "";
}

export function buildTimeline(comments = {}) {
  const events = [];
  for (const comment of comments.conversation || []) {
    events.push({ kind: "comment", at: comment.createdAt || "", comment });
  }
  for (const review of comments.reviews || []) {
    if (!(review.body || "").trim() && review.state === "COMMENTED") continue;
    events.push({ kind: "review", at: review.submittedAt || "", review });
  }
  for (const thread of comments.threads || []) {
    events.push({ kind: "thread", at: threadStart(thread), thread });
  }
  events.sort((a, b) => {
    if (!a.at && !b.at) return 0;
    if (!a.at) return 1;
    if (!b.at) return -1;
    return String(a.at).localeCompare(String(b.at));
  });
  return events;
}

function kindBadge(kind, reviewState) {
  if (kind === "comment") return paint(FG.blue, "comment");
  if (kind === "thread") return paint(FG.cyan, "thread");
  const state = String(reviewState || "").toUpperCase();
  if (state === "APPROVED") return paint(FG.green, "approved");
  if (state === "CHANGES_REQUESTED") return paint(FG.red, "changes");
  return paint(FG.gray, "review");
}

function previewText(text, width = 64) {
  const plain = String(text || "")
    .replace(/```[\s\S]*?```/g, "[code]")
    .replace(/!?\[[^\]]*]\([^)]+\)/g, "")
    .replace(/<img\b[^>]*>/gi, "")
    .replace(/[#>*_`|-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!plain) return paint(FG.gray, "·");
  if (plain.length <= width) return plain;
  return `${plain.slice(0, Math.max(12, width - 1))}…`;
}


export function threadLine(thread) {
  return thread?.line || thread?.originalLine || thread?.startLine || thread?.originalStartLine || null;
}

export function shortPath(path, line) {
  const name = String(path || "?").split("/").pop() || "?";
  return line ? `${name}:${line}` : name;
}

export function eventTargetUrl(event, pr) {
  if (event.kind === "comment") return event.comment?.url || pr?.url || null;
  if (event.kind === "review") return event.review?.url || pr?.url || null;
  const first = event.thread?.comments?.nodes?.[0];
  if (first?.url) return first.url;
  const line = threadLine(event.thread);
  if (pr?.repo && event.thread?.path && pr.headRefOid && line) {
    return `https://github.com/${pr.repo.owner}/${pr.repo.repo}/blob/${pr.headRefOid}/${event.thread.path}#L${line}`;
  }
  return pr?.url || null;
}

function renderTimelineEvent(event, width, selected) {
  const previewWidth = Math.max(24, width - 10);
  const mark = selected ? paint(FG.yellow, "▸") : " ";
  if (event.kind === "comment") {
    const comment = event.comment;
    return [
      `${mark} ${BOLD}${login(comment.author)}${RESET}  ${kindBadge("comment")}  ${paint(FG.gray, when(comment.createdAt))}`,
      `    ${previewText(comment.body, previewWidth)}`,
    ];
  }
  if (event.kind === "review") {
    const review = event.review;
    const lines = [
      `${mark} ${BOLD}${login(review.author)}${RESET}  ${kindBadge("review", review.state)}  ${paint(FG.gray, when(review.submittedAt))}`,
    ];
    if ((review.body || "").trim()) lines.push(`    ${previewText(review.body, previewWidth)}`);
    return lines;
  }
  const thread = event.thread;
  const replies = sortOldest(thread.comments?.nodes || [], "createdAt");
  const last = replies.at(-1);
  const open = !thread.isResolved;
  const line = threadLine(thread);
  return [
    `${mark} ${paint(FG.cyan, shortPath(thread.path, line))}  ${open ? paint(FG.yellow, "open") : paint(FG.gray, "done")}${thread.isOutdated ? paint(FG.gray, " old") : ""}  ${paint(FG.gray, when(threadStart(thread)))}`,
    `    ${BOLD}${login(last?.author || replies[0]?.author)}${RESET}  ${previewText(last?.body || replies[0]?.body, previewWidth)}`,
  ];
}


export function formatSnapshot(snapshot, options = {}) {
  const width = Number(options.width) || Number(process.env.COLUMNS) || 72;
  if (!snapshot) {
    return "No GitHub PR cached for this workspace.\nFocus a pane in a branch that has a PR, then refresh.";
  }
  if (snapshot.error) return `GitHub PR sync failed: ${snapshot.error}`;
  if (!snapshot.pr) return snapshot.message || "No pull request for the current branch.";

  const pr = snapshot.pr;
  const comments = snapshot.comments || { conversation: [], reviews: [], threads: [] };
  const counts = snapshot.counts || { conversation: 0, reviews: 0, unresolved: 0 };
  const chips = [presentLifecycle(pr), presentChecks(pr.checksStatus), presentReview(pr.reviewDecision), presentMerge(pr)].filter(Boolean);
  const timeline = buildTimeline(comments);
  const selected = Math.min(Math.max(Number(options.selected) || 0, 0), Math.max(timeline.length - 1, 0));
  const failing = (pr.checks || []).filter((check) => {
    const bucket = (check.bucket || "").toLowerCase();
    return bucket === "fail" || bucket === "pending";
  });

  const lines = [
    `${paint(FG.cyan, BOLD + hyperlink(pr.url, `#${pr.number}`) + RESET + FG.cyan)}  ${BOLD}${pr.title}${RESET}`,
    chips.map((item) => chip(item)).join("  "),
    `${paint(FG.blue, pr.headRefName)} ${paint(DIM, "→")} ${paint(FG.blue, pr.baseRefName)}  ${paint(FG.gray, when(pr.updatedAt))}`,
  ];

  if (failing.length) {
    lines.push("");
    for (const check of failing.slice(0, 8)) {
      const fail = (check.bucket || "").toLowerCase() === "fail";
      lines.push(`  ${paint(fail ? FG.red : FG.yellow, fail ? "fail" : "pend")}  ${check.name}`);
    }
    if (failing.length > 8) lines.push(paint(FG.gray, `  … ${failing.length - 8} more`));
  }

  const extra = counts.unresolved ? `${counts.unresolved} open` : `${timeline.length}`;
  lines.push("", section("Activity", timeline.length, extra, width));
  if (!timeline.length) {
    lines.push(paint(FG.gray, "  No comments yet."));
  } else {
    timeline.forEach((event, index) => {
      if (index) lines.push("");
      lines.push(...renderTimelineEvent(event, width, index === selected));
    });
  }

  return lines.join("\n");
}



export function formatToast(previous, current) {
  if (!current?.pr || !previous) return null;
  const pr = current.pr;
  const bits = [];
  if (previous.number !== pr.number) bits.push(`#${pr.number} ${pr.title}`);
  if (previous.checks !== current.identity.checks) bits.push(`checks ${current.pr.checksStatus}`);
  if (previous.reviewDecision !== current.identity.reviewDecision) {
    bits.push(`review ${reviewLabel(pr.reviewDecision)}`);
  }
  if (previous.comments !== current.identity.comments) {
    bits.push(current.counts.unresolved > 0 ? `${current.counts.unresolved} unresolved` : "new comments");
  }
  if (!bits.length) return null;
  return bits.join(" · ");
}
