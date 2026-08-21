# herdr-github-pr

Herdr plugin that syncs the current branch GitHub pull request into the sidebar and a split pane.

Core, not a clone of Orca: resolve the branch PR with `gh`, roll up check/review status, fetch conversation comments plus review threads, cache them, and surface changes.

## Requirements

- Herdr >= 0.7.4
- Node.js >= 18
- `git` and authenticated `gh` (`gh auth status`)

## Install

```sh
herdr plugin link /home/woshahua/Projects/github.com/herdr-github-pr
```

Or after this repo is on GitHub:

```sh
herdr plugin install woshahua/herdr-github-pr
```

## Sidebar

The plugin writes workspace/pane tokens `pr`, `pr_status`, `pr_comments`, and `pr_review`. Herdr only renders tokens you place in the row config:

```toml
[ui.sidebar.agents]
rows = [["state_icon", "workspace", "$pr"], ["agent", "$pr_status", "$pr_comments"]]

[ui.sidebar.spaces]
rows = [["state_icon", "workspace"], ["branch", "$pr", "$pr_status"]]
```

Then `herdr server reload-config`.

Labels look like `#123 ✓`, `#123 draft ●`, `#123 ⊘ ✓`, plus `closed · pass` / `2 unresolved`.


## Actions

The pane is a compact review card. Threads show `file:line`, not the full path. `j`/`k` move, `enter` opens that comment on GitHub (the line if GitHub still has one). `2`/`3`/`4` filter comments, reviews, or threads. `r` refresh, `o` open the PR, `q` close.

```sh
herdr plugin action invoke github-pr.refresh
herdr plugin action invoke github-pr.show
herdr plugin action invoke github-pr.open-web
```

Optional keybindings. `prefix+shift+g` often does not reach Herdr from a terminal, so use one of these:

```toml
[[keys.command]]
key = "ctrl+alt+g"
type = "plugin_action"
command = "github-pr.show"
description = "show GitHub PR"

[[keys.command]]
key = "prefix+m"
type = "plugin_action"
command = "github-pr.show"
description = "show GitHub PR"

[[keys.command]]
key = "ctrl+alt+u"
type = "plugin_action"
command = "github-pr.refresh"
description = "refresh GitHub PR"
```



Ctrl-click a `https://github.com/owner/repo/pull/N` URL to open the same pane.


## What syncs

- PR number, title, draft/open/merged/closed
- head/base branch, author, mergeability
- check rollup from `gh pr checks`
- review decision
- conversation comments, review submissions, inline review threads (resolved/outdated)

Automatic refresh runs on `pane.focused`, `worktree.opened`, `worktree.created`, and once at server startup. Automatic `gh` calls are throttled to once per pane/cwd every 30 seconds. Manual refresh always runs.

New comments, unresolved threads, check flips, or review-decision changes raise a Herdr notification.

State lives in `herdr plugin config-dir` / `HERDR_PLUGIN_STATE_DIR`, never in the plugin checkout.

## Develop

```sh
node --test
herdr plugin link .
herdr plugin action list --plugin github-pr
```
