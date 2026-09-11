# zread configuration reference / zread 配置参考

Everything here was verified against `zread` 0.2.13 (npm channel).
本文件所有内容均在 `zread` 0.2.13（npm 渠道）上实测确认。

## 1. Where the config lives / 配置文件位置

| OS | Path |
| --- | --- |
| Windows | `C:\Users\<你>\.zread\config.yaml` |
| macOS | `~/.zread/config.yaml` |
| Linux | `~/.zread/config.yaml` |

Related paths / 相关文件：

| Path | Purpose / 用途 |
| --- | --- |
| `~/.zread/config.yaml` | LLM provider, model, key, concurrency（LLM 与并发配置） |
| `~/.zread/login.json` | exists after a successful `zread login`（登录后出现） |
| `~/.zread/log/zread.log` | first place to look when a run misbehaves（排障第一现场） |
| `~/.zread/device_mid` | device id（设备标识） |

The config file **does not exist** on a fresh install; `zread login` or saving
inside `zread config` creates it.
全新安装时该文件**不存在**，需执行 `zread login` 或在 `zread config` 中保存后生成。

## 2. Full file shape / 完整字段

```yaml
language: zh-CN            # 对话/生成语言，可留空（留空时实测为 en）
doc_language: zh-CN        # 文档语言，可留空
llm:
    provider: deepseek     # z.ai | deepseek | moonshot | openai | 自定义
    model: deepseek-chat
    api_key: <YOUR_KEY>
    base_url: https://api.deepseek.com
concurrency:
    max_concurrent: 2      # 默认 1
    max_retries: 3         # 默认 0
```

| YAML path | `zread config --stdio` key | Default | Notes / 说明 |
| --- | --- | --- | --- |
| `language` | `language` | *(empty)* | Generation language; empty ⇒ English（留空时为英文） |
| `doc_language` | `doc_language` | *(empty)* | Language of the produced pages（产出文档语言） |
| `llm.provider` | `llm_provider` | `z.ai` | Provider preset / 服务商预设 |
| `llm.model` | `llm_model` | `glm-5` | Model id / 模型名 |
| `llm.api_key` | `llm_api_key` | *(empty)* | **Required** / 必填 |
| `llm.base_url` | `llm_base_url` | `https://open.bigmodel.cn/api/paas/v4` | OpenAI-compatible endpoint; zread appends `/chat/completions` / 兼容 OpenAI 的端点，zread 会追加 `/chat/completions` |
| `concurrency.max_concurrent` | `max_concurrent` | `1` | Parallel page workers / 并行生成页面数 |
| `concurrency.max_retries` | `max_retries` | `0` | Per-page retries before a page is marked failed / 单页失败前的重试次数 |

Note: `zread config --stdio` exposes `llm_provider` as read-only in the TUI but
**editable over stdio**. / 注：`llm_provider` 在 TUI 中为只读，但在 stdio 模式下可编辑。

## 3. How to configure / 三种配置方式

### a) `zread login`（最简单 / easiest）

OAuth login with 智谱/Z.AI; the API key is obtained and written automatically.
/ OAuth 登录智谱/Z.AI，自动获取并写入 API Key。

```bash
zread login            # interactive TUI / 交互式
zread login --custom   # skip the provider menu, open the config editor / 跳过菜单，直接手填
zread login --model <model-id>
```

### b) `zread config`（手填 / manual）

Interactive editor, or drive it over stdio / 交互式编辑器，或用 stdio 驱动：

```jsonc
{"type":"update_fields","params":{"fields":{
  "llm_provider":"deepseek",
  "llm_base_url":"https://api.deepseek.com",
  "llm_model":"deepseek-chat",
  "llm_api_key":"<YOUR_KEY>",
  "max_concurrent":"2",
  "max_retries":"3"
}}}
{"type":"save","params":{}}
```

`reload_llm` re-validates the provider settings; `quit` exits without saving.
/ `reload_llm` 重新校验服务商配置，`quit` 不保存退出。

### c) Edit the YAML directly / 直接编辑 YAML

Identical result; useful for scripting and for agents.
/ 效果相同，适合脚本与 Agent 使用。

## 4. Provider presets / 服务商预设

| provider | base_url | Example model / 示例模型 |
| --- | --- | --- |
| `z.ai` (bigmodel) | `https://open.bigmodel.cn/api/paas/v4` | `glm-5`, `glm-4.5-air` |
| `deepseek` | `https://api.deepseek.com` | `deepseek-chat` |
| `moonshot` | `https://api.moonshot.cn/v1` | *(see provider docs / 见官方)* |
| `openai` | `https://api.openai.com/v1` | *(see provider docs / 见官方)* |
| 自定义 / `__use_own_key__` | any OpenAI-compatible URL / 任意兼容地址 | any / 任意 |

Any OpenAI-compatible endpoint works — including a local vLLM/Ollama gateway.
/ 任意兼容 OpenAI 协议的端点都可用，包括本地 vLLM / Ollama 网关。

## 5. Tuning for 20+ page repos / 大仓库参数调优

| Setting | Default | Recommended / 建议 | Why / 原因 |
| --- | --- | --- | --- |
| `max_retries` | `0` | `3` | `0` makes **any** failing page park the run until a human answers / 为 0 时任一页面失败都会卡住整个任务 |
| `max_concurrent` | `1` | `2`–`4` | Shorter wall-clock ⇒ smaller interruption window; lower it if you hit 429 / 缩短总时长以减少中断窗口；遇到 429 就调低 |

Cost note / 成本提示：page count is decided by the catalog agent and is
unrelated to repo size — a 3-file repo already produced 8 pages.
页数由目录阶段决定，与仓库大小并非线性关系：实测 3 个文件的仓库也生成了 8 页。

## 6. Verify / 校验

```bash
# Windows
type %USERPROFILE%\.zread\config.yaml
# macOS / Linux
cat ~/.zread/config.yaml
```

Machine-readable / 机器可读（读取当前值后立即退出）：

```bash
zread config --stdio      # then send: {"type":"quit","params":{}}
```

The event lists all 9 fields; `llm_api_key` must be non-empty.
/ 返回的事件含 9 个字段，确认 `llm_api_key` 非空即可。

## 7. Error table / 报错对照

| Message / 报错 | Cause / 原因 | Fix / 处理 |
| --- | --- | --- |
| `401 ... 令牌已过期或验证不正确` | invalid or expired key / Key 无效或过期 | re-login or replace the key / 重新登录或换 Key |
| `401` on pages but catalog succeeded | quota / permissions / 额度或权限 | check the account / 检查账户额度 |
| `dial tcp ...: connectex: No connection could be made` | `base_url` unreachable or blocked / 地址不可达或被阻断 | fix `base_url`, use a proxy or another provider / 换地址/代理/服务商 |
| `LLM call failed after 4 attempts` | transient network or rate limit / 网络抖动或限流 | raise `max_retries`, lower `max_concurrent` / 提高重试、降低并发 |
| process sits still with no output / 进程卡住无输出 | a page failed and zread waits for `retry`/`skip_all` / 页面失败，等待指令 | use `scripts/zread-generate.mjs` / 改用监督脚本 |
| `draft wiki.json has empty ID, cannot commit` | corrupt draft / 草稿损坏 | `zread generate --draft clear -y` |

## 8. Security / 安全

`api_key` is stored in **plaintext** in `~/.zread/config.yaml`. Never commit
that file, and never paste the key into a repository.
/ `api_key` 以**明文**存放在 `~/.zread/config.yaml`，切勿提交或粘贴到仓库中。

## 9. Edge case: duplicate version id / 边界情况：版本 id 重复

If a draft's `id` already exists under `.zread/wiki/versions/`, the commit can
fail (observed as `state=error` with all pages done). Give the draft a fresh
`id` or clear it / 若草稿 id 与已有版本重复，提交会失败（表现为页面全完成但
`state=error`）。换个新 id 或 `--draft clear` 即可。
