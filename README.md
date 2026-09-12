# Zread Skill

This repository contains a skill for `zread`, a CLI that generates wiki-style
documentation for code repositories.

The skill is meant for one job: help an agent understand an unfamiliar codebase
through `zread` output instead of re-reading the entire repository file by file.

⭐ 在[zread-skill](https://github.com/ZreadAI/zread-skill.git)基础上修改为自用版本，添加 LLM API 配置文档并添加容错生成监督器脚本（可以选择AI自主控制该skill流程，也可以选择脚本，该脚本提供走完生成项目文档的最佳路径）

> **Language / 语言**：配置与恢复相关章节（第 3 节、Long runs、configuration.md）为中英对照；
> 其余章节保持英文。
> Sections about configuration and recovery (§3, "Long runs", `configuration.md`) are
> bilingual; the rest of this document stays in English.

## Installation

### 1. Install the zread CLI

Install `zread` first. There are two supported installation methods:

```bash
npm install -g zread_cli
```

or

```bash
brew tap ZreadAI/homebrew-tap
brew install zread
```

Then verify the installation:

```bash
zread version
```

### 2. Install this skill

Ask your AI agent to install the skill from GitHub:

```text
install this skill https://github.com/ZreadAI/zread-skill
```

If you prefer to install it manually, copy this directory into your local
skills directory:

| Agent       | Skills directory        |
| ----------- | ----------------------- |
| Claude Code | `~/.claude/skills/`   |
| OpenClaw    | `~/.openclaw/skills/` |
| Codex       | `~/.agents/skills/`   |

Example:

```bash
cp -R zread ~/.claude/skills/zread
```

Your final layout should look like this:

```text
<skills-dir>/zread/
  SKILL.md
  README.md
  references/
    stdio-protocol.md
```

Once the folder is in place, an agent that supports `SKILL.md`-based skills can
load and use it.

### 3. Configure the LLM API（配置 LLM API，必做 / required）

`zread` calls an LLM to write the docs, so `zread generate` cannot start without
an API key. / `zread` 通过大模型生成文档，没有 API Key 时 `zread generate` 无法启动。

Config file location / 配置文件位置：

| OS | Path |
| --- | --- |
| Windows | `C:\Users\<你>\.zread\config.yaml` |
| macOS / Linux | `~/.zread/config.yaml` |

The file does **not** exist until you run `zread login` or save inside
`zread config`. / 该文件默认不存在，执行 `zread login` 或在 `zread config` 中保存后才会生成。

Two supported paths / 两种配置方式：

1. `zread login` — OAuth into 智谱/Z.AI, the key is written for you.
   / OAuth 登录智谱/Z.AI，自动写入 `api_key`（最省事）。
2. `zread login --custom` or `zread config` — fill in
   `llm_provider` / `llm_base_url` / `llm_model` / `llm_api_key` by hand. Any
   OpenAI-compatible endpoint works (DeepSeek, Moonshot, OpenAI, local
   vLLM/Ollama…). / 手动填写，可用任意 OpenAI 兼容端点。

…or edit the file directly / 或直接编辑该文件：

```yaml
llm:
    provider: deepseek            # z.ai | deepseek | moonshot | openai | 自定义
    model: deepseek-chat
    api_key: <YOUR_KEY>
    base_url: https://api.deepseek.com
concurrency:
    max_concurrent: 2             # 默认 1；建议 2~4
    max_retries: 3                # 默认 0；务必 >= 1
```

> **Set `max_retries` / 请务必设置 `max_retries`**
> With the default `max_retries: 0`, a single failing page parks the whole run
> forever. / 默认值 0 会让任一页面失败就卡住整个任务。

Verify it / 校验：

```bash
# Windows
type %USERPROFILE%\.zread\config.yaml
# macOS / Linux
cat ~/.zread/config.yaml
```

Logs go to `~/.zread/log/zread.log` (Windows:
`C:\Users\<你>\.zread\log\zread.log`). / 日志位于 `~/.zread/log/zread.log`。

Full field reference, provider presets and error table:
[references/configuration.md](./references/configuration.md).
完整字段说明、各服务商预设与报错对照见 `references/configuration.md`。

## Features

- Read existing `./.zread/wiki/` output instead of crawling source files again
- Guide an agent to run `zread generate` safely when documentation does not
  exist yet
- Use `--stdio` as the default mode for agent automation, instead of parsing
  the interactive TUI
- Explain the role of `current`, `versions`, and `drafts` in zread output
- Include a reference for the `zread --stdio` JSON-line protocol
- Check the LLM API configuration before starting a paid, long-running job
  （生成前先校验 LLM 配置）
- Recover from interruptions instead of regenerating everything: resume,
  retry, and partial commit（中断可续传，而不是全部重新生成）
- `scripts/zread-generate.mjs`: one command that does all of the above —
  pre-flight check, resume, auto-retry, progress snapshot, watchdog
  （一条命令搞定以上全部：配置校验、续传、自动重试、进度快照、看门狗）

## When To Use

Use this skill when you want to:

- understand an unfamiliar repository quickly
- read an existing zread-generated wiki
- generate a repository overview or project wiki
- serve docs locally with `zread browse`
- drive `zread` programmatically from a script or agent

## How It Works

The skill follows a simple workflow:

1. If `./.zread/wiki/current` exists, read the generated wiki files directly.
2. If no wiki exists, run `zread generate` only when the user wants docs to be
   generated.
3. Before generation, confirm with the user because generation consumes LLM
   tokens and writes under `./.zread/`.
4. Generation runs through `scripts/zread-generate.mjs`, which verifies the
   LLM API key, resumes any unfinished draft, retries failures and records
   progress（生成统一走监督脚本：校验 Key、续传草稿、失败重试、记录进度）.
5. In automated workflows, use `--stdio` (the script already does this for
   you / 脚本内部已默认使用 `--stdio`).

## Repository Layout

- `SKILL.md`: the skill definition, trigger conditions, and operating rules
- `references/stdio-protocol.md`: the `zread --stdio` machine protocol
- `references/configuration.md`: LLM API configuration, providers, tuning,
  error table（LLM 配置、服务商、参数调优、报错对照）
- `scripts/zread-generate.mjs`: resilient supervisor for `zread generate`
  (retry / resume / watchdog)（`zread generate` 容错监督脚本）
- `appmap.log`: local artifact, not part of the skill itself

## zread Output

After a successful generation, zread typically writes:

- `./.zread/wiki/current`: the active wiki version id
- `./.zread/wiki/versions/<id>/wiki.json`: the generated page index
- `./.zread/wiki/versions/<id>/<file>`: the actual markdown pages
- `./.zread/wiki/drafts/`: unfinished generation state

Resolve links by their **target**, not their text (the text is often just a
basename). Strip the leading `../` sequence, then join onto the repo root.
/ 按**目标**解析，不用链接文字（文字常只有文件名）：去掉 `../` 后拼到仓库根。

```text
[base.py](../../../../src/app/base.py#L14)  →  <repo-root>/src/app/base.py   (#L14 = 行号)
[Foo](7-foo)                                →  .zread/wiki/versions/<id>/7-foo.md  (裸 slug = 另一页)
```

If you need to integrate with `zread` programmatically, see
[references/stdio-protocol.md](./references/stdio-protocol.md).

## Long runs: interruption & resume（长任务：中断与续传）

A real repo easily produces 20+ pages, so a run can last a long time. The
behaviours below were measured against `zread` 0.2.13 — they are the reason a
plain `zread generate -y` appears to "lose everything".
真实仓库动辄 20+ 页，一次生成耗时很长。以下行为均在 `zread` 0.2.13 上实测确认，
也是"裸跑 `zread generate -y` 会全部重来"的原因。

| What happens / 现象 | What it means / 含义 |
| --- | --- |
| LLM call fails | Retried internally 4 times before giving up / 内部重试 4 次 |
| Catalog phase fails | Process parks in `waiting_for: ["quit","retry_catalog"]`; **nothing is written to disk** / 进程停住等待，**无任何落盘** |
| A page fails | Does **not** abort and does **not** auto-commit: zread parks in `pages.waiting_retry = true` waiting for `retry` / `skip_all` / 不会自动中止也不会自动提交，而是无限等待 `retry` / `skip_all` |
| `quit` or a hard kill | `.zread/wiki/drafts/` survives / 草稿目录保留 |
| `--draft resume` | Catalog is skipped entirely; finished pages become `resumed` and are not regenerated / 目录阶段整段跳过，已完成页标记为 `resumed`，不重生成 |
| `skip_all` / `--skip-failed` | Commits a **partial** wiki and **deletes** the draft — missing pages can no longer be resumed / 提交残缺版本并删除草稿，缺失页无法再续传 |
| `-y` without `--draft` | Ignores an existing draft (scenario reported as `empty`) / 忽略已有草稿 |

### Use the supervisor script / 用监督脚本运行

```bash
node scripts/zread-generate.mjs --cwd /path/to/repo
```

- Pre-flight: fails fast (exit 3) when the API key is missing, warns when
  `max_retries < 1` / 缺 Key 直接退出（3），`max_retries < 1` 时告警
- Auto `--draft resume` when a draft exists / 有草稿自动续传
- Auto `retry_catalog` with backoff, auto per-page `retry` / 自动重试目录与页面
- Writes `.zread/agent-progress.json` (done/total + failed slugs) /
  记录进度快照
- Idle watchdog + Ctrl-C ⇒ graceful quit, draft kept / 空闲超时与 Ctrl-C 均优雅退出并保留草稿
- `--skip-failed` is **opt-in**, because it destroys resumability /
  `--skip-failed` 需显式开启，因为它会放弃续传能力

Exit codes / 退出码：`0` OK | `1` PARTIAL | `2` CATALOG_FAILED | `3` NO_CONFIG |
`4` IDLE_TIMEOUT | `130` INTERRUPTED

Inspect state at any time / 随时查看状态：

```bash
node scripts/zread-generate.mjs --cwd /path/to/repo --status
```
