---
name: zread
description: Produce and consume a wiki-style knowledge base for a code repository via the `zread` CLI and its on-disk output under `./.zread/wiki/`. Use this skill whenever the user wants to understand, onboard onto, explore, summarize, map, or get an overview of an unfamiliar codebase; asks for architecture docs, a project wiki, a repo walkthrough, module/package explanations, or "what does this repo do"; wants to generate, regenerate, resume, browse, or serve code documentation locally; or mentions zread / zread.ai directly. Also use it proactively before diving into a large unknown repo — if `./.zread/wiki/current` exists, read the generated pages instead of crawling source file-by-file; if it doesn't, consider offering to run `zread generate`. Also use it when the user needs to configure the zread LLM API (api key / provider / base_url / model), or when a generation run failed, hung, or was interrupted and must be resumed rather than restarted. The trigger is the intent (understand a codebase through generated docs), not the literal word "zread".
---

# zread skill

`zread` is a CLI that generates wiki documentation from code in the current
workspace using an LLM. Output lives under `./.zread/wiki/` in the workspace;
public repos can also be viewed at https://zread.ai.

This skill is intended for agent use. Read generated files directly from disk,
and use `--stdio` as the default mode for any zread command instead of trying
to parse the human TUI.

**For generating docs, do not invoke `zread generate` directly** — use the
bundled supervisor instead:
`node <skill-dir>/scripts/zread-generate.mjs --cwd <repo>`
It checks the LLM config, resumes drafts, retries failures, and never hangs
silently. See "Failure semantics & recovery" below.
**生成文档时不要直接调 `zread generate`**，改用自带监督脚本：它会校验配置、
自动续传、自动重试，不会静默卡死。详见下文「Failure semantics & recovery」。

## On-disk layout (read these directly)

Always run `zread` from the workspace root. After a successful generation:

- `./.zread/wiki/current` — text file containing the active version id
  (e.g. `2026-03-12-010203`).
- `./.zread/wiki/versions/<id>/wiki.json` — TOC: `{id, generated_at, language,
  pages: [{slug, title, file, section, group, level}]}`.
- `./.zread/wiki/versions/<id>/<file>` — page markdown referenced by `pages[*].file`.
- `./.zread/wiki/drafts/` — in-progress generation; presence means a previous
  run did not finish. `drafts/wiki.json` exists once the catalog phase
  completed.
- `./.zread/agent-progress.json` — progress snapshot written by
  `scripts/zread-generate.mjs` (`done/total`, failed slugs, catalog error).
- `~/.zread/config.yaml` — global config (LLM provider, language, concurrency).
  Windows: `C:\Users\<user>\.zread\config.yaml`. It does not exist until
  `zread login` or a `zread config` save. See
  [references/configuration.md](./references/configuration.md).
- `~/.zread/login.json` — presence indicates the user has logged in.
- `~/.zread/log/zread.log` — run log; read it first when something fails.

To answer questions about a codebase that already has zread output, read these
files directly with the file tools — do not invoke `zread browse`.

## Commands

| Command | Purpose | Key flags |
|---|---|---|
| `zread generate` | Generate wiki for cwd | `-y/--yes`, `--draft resume\|clear\|cancel`, `--skip-failed`, `--stdio` |
| `zread browse` | Serve docs at http://localhost:9681+ and open browser | `--generate`, `--version <id>`, `--host`, `--port`, `--stdio` |
| `zread login` | OAuth into BigModel/Z.AI to obtain an API key | `--custom`, `--model`, `--stdio` |
| `zread config` | Edit `~/.zread/config.yaml` | `--stdio` |
| `zread update` | Self-update CLI | `--stdio` |
| `zread version` | Print version | `--stdio` |
| `scripts/zread-generate.mjs` | **Recommended** supervisor wrapper around `zread generate` / 推荐的 `generate` 封装 | `--cwd`, `--fresh`, `--skip-failed`, `--catalog-retries`, `--page-retries`, `--idle-timeout`, `--status` |

`--stdio` is supported on every command and turns the process into a JSON-line
machine protocol on stdin/stdout. See
[references/stdio-protocol.md](./references/stdio-protocol.md) for the wire
format (events, `waiting_for`, `done`, `quit`). Load it whenever zread is
invoked from another program/agent.

## Decision tree for an AI agent

1. **User wants to read existing wiki content?**
   - Check `./.zread/wiki/current`. If present, read `wiki.json` and the page
     markdown directly. No CLI invocation needed.
   - For known *public* GitHub repos, prefer the `mcp__zread__*` tools
     (`get_repo_structure`, `read_file`, `search_doc`) over running the CLI.

2. **User wants to (re)generate docs?**
   - Confirm with the user first — `generate` is long-running, calls an LLM,
     and writes files. Get explicit consent in unfamiliar directories.
   - **Pre-flight (mandatory) / 生成前必做**：read `~/.zread/config.yaml`
     (Windows `C:\Users\<user>\.zread\config.yaml`) and confirm
     `llm.api_key` is non-empty. If the file or the key is missing, stop and
     tell the user to run `zread login` (or `zread config`) — do not start a
     run that can only fail at the LLM call. Fields and provider presets:
     [references/configuration.md](./references/configuration.md).
     读取配置文件并确认 `llm.api_key` 非空；缺失就先让用户配置，不要开跑。
   - **Prefer the supervisor script / 优先用监督脚本**：
     `node <skill-dir>/scripts/zread-generate.mjs --cwd <repo>`
     It pre-flights the config, auto-resumes drafts, retries catalog and page
     failures, snapshots progress, and exits with a documented exit code.
   - If driving zread manually instead:
     - `./.zread/wiki/drafts/wiki.json` exists → `zread generate -y --draft resume --stdio`
     - want a clean start → `zread generate -y --draft clear --stdio`
     - no draft → `zread generate -y --stdio`
     - **Never pass `-y` alone while a draft exists** — zread then reports
       scenario `empty` and restarts from scratch, discarding finished pages.
       有草稿时绝不能只给 `-y`，zread 会按 empty 场景重跑，丢掉已完成页面。
   - `--skip-failed` commits a partial wiki and **deletes** the draft; missing
     pages can then never be resumed. Only use it when the user accepts the
     gaps — otherwise let the run stop and resume later.
     `--skip-failed` 会提交残缺版本并删除草稿，缺失页无法再续传。

3. **User wants to view docs in a browser?**
   - `zread browse` (add `--generate` to bootstrap if no wiki exists yet).

4. **User wants to script zread / consume output programmatically?**
   - Use `--stdio` and follow stdio-protocol.md. Do not screen-scrape the TUI.

## Non-interactive invocation rules

- Always pass `-y` to `generate` when running unattended; otherwise it stops
  at a catalog confirmation gate.
- Always set `--draft` explicitly when a draft may exist, so the command does
  not prompt.
- For any command run from another agent/script, use `--stdio` so output is
  parseable JSON instead of ANSI TUI frames.
- `zread` writes logs to `~/.zread/log/zread.log` — read this if a run fails
  silently.

## Failure semantics & recovery（失败语义与恢复）

Measured on `zread` 0.2.13 — treat these as the contract, not as guesses.
以下行为在 `zread` 0.2.13 上实测确认，请按契约对待，不要凭猜测。

| Situation / 场景 | Actual behaviour / 实际行为 |
|---|---|
| An LLM call fails | Retried internally 4 times, then the task fails / 内部重试 4 次后才失败 |
| Catalog phase fails | `waiting_for: ["quit","retry_catalog"]`; **nothing is written to disk** / 无任何落盘，重试无成本 |
| A page fails | zread does **not** abort: remaining workers finish first, then `pages.waiting_retry = true` and it waits for `retry` / `skip_all` — indefinitely if nobody answers / 不会中止，其余任务跑完后统一结算并无限等待指令 |
| `max_retries` | Per-page auto retries; `0` (default) ⇒ fail immediately / 单页自动重试次数，默认 0 即立即失败 |
| `quit` or hard kill | `.zread/wiki/drafts/` is preserved (verified) / 草稿保留（已验证） |
| `--draft resume` | Catalog skipped (`catalog.status = resumed`); finished pages are `resumed`, not regenerated / 目录阶段跳过，已完成页不重生成 |
| `skip_all` / `--skip-failed` | Commits a partial wiki, **deletes** the draft / 提交残缺版本并删除草稿 |

Recovery decision table / 恢复决策表：

| Disk state / 磁盘状态 | Action / 动作 |
|---|---|
| No `.zread/` at all | Fresh run / 全新生成 |
| `.zread/wiki/drafts/wiki.json` exists | `--draft resume` — never restart / 必须续传，绝不重跑 |
| Only `versions/`, no draft | Regeneration is unavoidable; ask the user first (it re-spends tokens) / 只能重生成，先征求用户同意（会再次消耗额度） |
| Catalog failed, no draft | Fix key / `base_url`, then re-run — nothing was lost / 修好配置直接重跑，无损失 |
| Pages failed, retries exhausted | Either `--skip-failed` (accept gaps, draft deleted) or stop and `resume` later / 二选一：接受缺失并提交，或停下来日后续传 |
| All pages done but `state=error` | Draft `id` collides with an existing version → `--draft clear` / 草稿 id 与已有版本重复 |

Agent rules / 操作规则：

- Always report the **slug list of failed pages** to the user; do not silently
  present a partial wiki as complete. / 必须把失败页清单报给用户，不能把残缺文档当完整结果。
- To abandon a run, use `quit` (stdio) or Ctrl-C on the script — both keep the
  draft. Never `--draft clear` "just to be safe". / 放弃运行用 `quit` 或 Ctrl-C，
  都会保留草稿；不要随手 `--draft clear`。
- After a network outage, just re-run the same resume command; already
  generated pages are never regenerated. / 网络恢复后重跑同一条续传命令即可，
  已生成页面不会重复消耗。

## Safety / blast radius

- `generate` consumes LLM tokens (real cost) and can run for many minutes on
  large repos. Confirm before launching.
- `generate` writes only under `./.zread/` and does not commit anything to
  git. It is safe to delete `./.zread/wiki/drafts/` to recover from a stuck
  state.
- `update` replaces the zread binary in place and is hard to reverse — only
  run it when the user explicitly asks.
- `login` opens a browser for OAuth; do not run it in a non-interactive
  context unless the user has asked for it.

## Reference files

- [references/stdio-protocol.md](./references/stdio-protocol.md) — JSON-line
  wire protocol shared by every command's `--stdio` mode. Load when
  programmatically driving zread.
- [references/configuration.md](./references/configuration.md) — LLM API
  config: file location, all fields, provider presets, tuning, error table.
  Load before any `generate` run, and whenever the user reports 401/network
  errors. / LLM 配置：文件位置、全部字段、服务商预设、调优、报错对照。
- [scripts/zread-generate.mjs](../scripts/zread-generate.mjs) — resilient
  supervisor (pre-flight, resume, retry, watchdog, exit codes). Prefer it over
  invoking `zread generate` directly. / 容错监督脚本，优先于直接调用
  `zread generate`。
