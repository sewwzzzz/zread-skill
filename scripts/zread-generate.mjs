#!/usr/bin/env node
/**
 * zread-generate.mjs — resilient supervisor for `zread generate`
 * zread-generate.mjs — `zread generate` 的容错监督脚本
 *
 * Why / 为什么需要它
 * ------------------
 * Verified behaviour of the raw CLI (measured, not guessed):
 *   1. A failed page does NOT abort and does NOT auto-commit. zread parks in
 *      `pages.waiting_retry = true` and waits forever for `retry` / `skip_all`.
 *      An unattended run therefore hangs instead of finishing.
 *      页面失败不会自动中止、也不会自动提交，进程会无限期停在
 *      `pages.waiting_retry = true` 等待 `retry` / `skip_all`，无人应答就一直挂着。
 *   2. A failed catalog phase parks in `waiting_for: ["quit","retry_catalog"]`
 *      and writes nothing to disk.
 *      目录阶段失败会停在 `waiting_for: ["quit","retry_catalog"]`，且无任何落盘。
 *   3. `quit` (graceful) AND a hard kill both preserve `.zread/wiki/drafts/`,
 *      so `--draft resume` continues: the catalog step is skipped entirely and
 *      already-finished pages are marked `resumed` (not regenerated).
 *      优雅 `quit` 与硬 kill 都会保留 `.zread/wiki/drafts/`，`--draft resume`
 *      可继续：目录阶段整段跳过，已完成页面标记为 `resumed`，不会重生成。
 *   4. `skip_all` / `--skip-failed` COMMITS a partial wiki and DELETES the draft.
 *      After that there is no way to generate only the missing pages.
 *      `skip_all` / `--skip-failed` 会提交残缺版本并删除草稿，
 *      此后无法只补缺失页，只能整本重生成。
 *   5. `-y` alone ignores an existing draft (scenario reported as "empty").
 *      Always pass `--draft resume` explicitly when a draft exists.
 *      只给 `-y` 会忽略已存在的草稿（scenario 显示为 "empty"），
 *      有草稿时必须显式传 `--draft resume`。
 *
 * Usage / 用法
 *   node scripts/zread-generate.mjs [options]
 *     --cwd <dir>            repo to document (default: process.cwd())
 *                            要生成文档的项目目录（默认当前目录）
 *     --fresh                discard any existing draft (`--draft clear`)
 *                            丢弃已有草稿（`--draft clear`）
 *     --skip-failed          after retries are exhausted, commit the partial wiki
 *                            (DESTRUCTIVE: the draft is deleted, missing pages
 *                            can no longer be resumed)
 *                            重试耗尽后提交残缺版本（有代价：草稿被删除，
 *                            缺失页无法再续传）
 *     --catalog-retries <n>  catalog retry attempts (default 3)
 *     --page-retries <n>     manual retries per failed page (default 2)
 *     --idle-timeout <sec>   quit if no event for this long (default 900)
 *                            超过该时间没有任何事件则优雅退出
 *     --status               print progress snapshot and exit
 *     -h, --help             show help
 *
 * Exit codes / 退出码
 *   0   OK / 全部完成
 *   1   PARTIAL / 部分完成（有页面被跳过或仍失败，草稿可能仍保留）
 *   2   CATALOG_FAILED / 目录阶段失败（无落盘，重跑即可）
 *   3   NO_CONFIG / 未配置 LLM API Key
 *   4   IDLE_TIMEOUT / 空闲超时（已优雅退出，草稿保留，可续传）
 *   130 INTERRUPTED / 被 Ctrl-C 中断（草稿保留，可续传）
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const EXIT = { OK: 0, PARTIAL: 1, CATALOG_FAILED: 2, NO_CONFIG: 3, IDLE_TIMEOUT: 4, INTERRUPTED: 130 };

// ---------------------------------------------------------------- args / 参数
function parseArgs(argv) {
  const opts = {
    cwd: process.cwd(),
    fresh: false,
    skipFailed: false,
    catalogRetries: 3,
    pageRetries: 2,
    idleTimeout: 900,
    status: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--cwd': opts.cwd = path.resolve(argv[++i]); break;
      case '--fresh': opts.fresh = true; break;
      case '--skip-failed': opts.skipFailed = true; break;
      case '--catalog-retries': opts.catalogRetries = Number(argv[++i]); break;
      case '--page-retries': opts.pageRetries = Number(argv[++i]); break;
      case '--idle-timeout': opts.idleTimeout = Number(argv[++i]); break;
      case '--status': opts.status = true; break;
      case '-h': case '--help': opts.help = true; break;
      default:
        console.error(`unknown option / 未知参数: ${a}`);
        process.exit(64);
    }
  }
  return opts;
}

const HELP = `zread-generate.mjs — resilient \`zread generate\` supervisor（容错监督脚本）

node scripts/zread-generate.mjs [--cwd <dir>] [--fresh] [--skip-failed]
                                [--catalog-retries 3] [--page-retries 2]
                                [--idle-timeout 900] [--status]

Exit codes / 退出码: 0 OK | 1 PARTIAL | 2 CATALOG_FAILED | 3 NO_CONFIG | 4 IDLE_TIMEOUT | 130 INTERRUPTED
See the file header for the verified CLI behaviours this compensates for.
文件头部注释列出了本脚本所补偿的、经实测确认的 CLI 行为。`;

// ------------------------------------------------------------- config / 配置
function configPath() {
  return path.join(os.homedir(), '.zread', 'config.yaml');
}

/** Minimal flat YAML reader: supports `key:` sections and `key: value` leaves. */
function readConfig(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  let section = '';
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '');
    if (!line.trim()) continue;
    const indent = line.match(/^\s*/)[0].length;
    const m = line.match(/^\s*([A-Za-z0-9_.-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const [, key, rawVal] = m;
    const val = rawVal.trim().replace(/^["']|["']$/g, '');
    if (indent === 0 && val === '') { section = key; out[key] = out[key] || {}; }
    else if (indent === 0) out[key] = val;
    else if (section) out[`${section}.${key}`] = val;
    else out[key] = val;
  }
  return out;
}

function preflight(cfgFile) {
  const cfg = readConfig(cfgFile);
  const key = (cfg['llm.api_key'] || '').trim();
  if (!key) {
    console.error('[zread] LLM API key is not configured / 未配置 LLM API Key.');
    console.error(`[zread] config file / 配置文件: ${cfgFile}`);
    console.error('[zread] Add it with `zread config` (set llm_api_key) or edit the file:');
    console.error('[zread]   或用 `zread config` 设置 llm_api_key，或直接编辑该文件:');
    console.error('        llm:');
    console.error('            provider: deepseek');
    console.error('            model: deepseek-chat');
    console.error('            api_key: <YOUR_KEY>');
    console.error('            base_url: https://api.deepseek.com');
    console.error('[zread] See references/configuration.md for all providers.');
    console.error('[zread] 全部可用服务商见 references/configuration.md。');
    process.exit(EXIT.NO_CONFIG);
  }
  const retries = Number(cfg['concurrency.max_retries'] ?? 0);
  if (!Number.isFinite(retries) || retries < 1) {
    console.warn('[zread] warning: concurrency.max_retries < 1 — every failed page will park the run.');
    console.warn('[zread] 警告: concurrency.max_retries < 1，任一页面失败都会让任务停住。');
    console.warn('[zread] recommended / 建议: concurrency.max_retries: 3');
  }
  return cfg;
}

// ------------------------------------------------------------- status / 状态
function draftsDir(cwd) { return path.join(cwd, '.zread', 'wiki', 'drafts'); }
function progressFile(cwd) { return path.join(cwd, '.zread', 'agent-progress.json'); }
function currentFile(cwd) { return path.join(cwd, '.zread', 'wiki', 'current'); }

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function printStatus(cwd) {
  const draft = readJson(path.join(draftsDir(cwd), 'wiki.json'));
  const prog = readJson(progressFile(cwd));
  const cur = fs.existsSync(currentFile(cwd))
    ? fs.readFileSync(currentFile(cwd), 'utf8').trim() : null;
  const version = cur ? readJson(path.join(cwd, '.zread', 'wiki', cur, 'wiki.json')) : null;
  console.log(JSON.stringify({
    cwd,
    draft: draft ? { id: draft.id, pages: draft.pages.map((p) => p.slug) } : null,
    draft_files: fs.existsSync(draftsDir(cwd)) ? fs.readdirSync(draftsDir(cwd)) : [],
    current_version: cur,
    version_pages: version ? version.pages.map((p) => p.slug) : null,
    last_progress: prog,
  }, null, 2));
}

// -------------------------------------------------------------- run / 主流程
function run(opts) {
  const cwd = opts.cwd;
  const hasDraft = fs.existsSync(path.join(draftsDir(cwd), 'wiki.json'));
  const args = ['generate', '-y'];
  if (hasDraft) args.push('--draft', opts.fresh ? 'clear' : 'resume');
  args.push('--stdio');
  if (opts.skipFailed) args.push('--skip-failed');

  console.log(`[zread] cwd=${cwd}`);
  console.log(`[zread] draft=${hasDraft ? (opts.fresh ? 'found -> clear' : 'found -> resume') : 'none'}`);
  console.log(`[zread] cmd: zread ${args.join(' ')}`);

  const started = Date.now();
  const stamp = () => ((Date.now() - started) / 1000).toFixed(1);
  let lastEventAt = Date.now();
  let catalogRetries = 0;
  const pageRetries = new Map();
  let lastVm = {};
  let exiting = null;

  const child = spawn('zread', args, { cwd, shell: true, stdio: ['pipe', 'pipe', 'pipe'] });

  const saveProgress = (vm) => {
    const p = vm.pages || {};
    const snap = {
      started_at: new Date(started).toISOString(),
      updated_at: new Date().toISOString(),
      state: vm.state,
      catalog_status: (vm.catalog || {}).status,
      catalog_error: (vm.catalog || {}).error || null,
      done: p.done ?? 0,
      total: p.total ?? 0,
      waiting_retry: !!p.waiting_retry,
      failed: (p.tasks || []).filter((t) => t.state === 'failed')
        .map((t) => ({ id: t.id, slug: t.slug, error: (t.error || '').slice(0, 200) })),
    };
    try {
      fs.mkdirSync(path.dirname(progressFile(cwd)), { recursive: true });
      fs.writeFileSync(progressFile(cwd), JSON.stringify(snap, null, 2));
    } catch { /* best effort / 尽力而为 */ }
    return snap;
  };

  const send = (obj) => { try { child.stdin.write(JSON.stringify(obj) + '\n'); } catch { /* ignore */ } };

  const gracefulQuit = () => {
    if (exiting) return;
    exiting = true;
    send({ type: 'quit', params: {} });
    setTimeout(() => { try { child.kill(); } catch { /* ignore */ } }, 5000);
  };

  let buf = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      let ev;
      try { ev = JSON.parse(line); } catch { continue; }
      lastEventAt = Date.now();
      const wf = ev.waiting_for || [];
      const vm = ev.vm || {};
      lastVm = vm;
      const p = vm.pages || {};
      const snap = saveProgress(vm);
      console.log(`[${stamp()}s] state=${vm.state} catalog=${(vm.catalog || {}).status} pages=${p.done ?? 0}/${p.total ?? 0} waiting_retry=${!!p.waiting_retry} done=${!!ev.done}`);

      if (ev.done) {
        const failed = snap.failed.length;
        if (failed) {
          console.log(`[zread] PARTIAL: ${snap.done}/${snap.total} pages, ${failed} failed:`);
          console.log('[zread] 部分完成: 失败页面如下（若未使用 --skip-failed，草稿仍保留，可续传）');
          for (const f of snap.failed) console.log(`         - ${f.slug}: ${f.error}`);
        } else {
          console.log(`[zread] DONE: ${snap.done}/${snap.total} pages / 全部完成`);
        }
        const cur = fs.existsSync(currentFile(cwd)) ? fs.readFileSync(currentFile(cwd), 'utf8').trim() : null;
        if (cur) console.log(`[zread] current version / 当前版本: ${cur}`);
        process.exit(failed ? EXIT.PARTIAL : EXIT.OK);
      }
      if (exiting) continue;

      // catalog phase failed / 目录阶段失败
      if ((vm.catalog || {}).status === 'error' && wf.includes('retry_catalog')) {
        if (catalogRetries < opts.catalogRetries) {
          const delay = Math.min(5000 * 2 ** catalogRetries, 60000);
          catalogRetries += 1;
          console.log(`[zread] catalog failed, retry ${catalogRetries}/${opts.catalogRetries} in ${delay / 1000}s`);
          console.log('[zread] 目录阶段失败，退避重试（此阶段无落盘，重试无成本）');
          setTimeout(() => send({ type: 'retry_catalog', params: {} }), delay);
        } else {
          console.error('[zread] CATALOG_FAILED: giving up. Nothing was written; re-run once the LLM endpoint is healthy.');
          console.error('[zread] 目录阶段失败且重试耗尽：本次无任何落盘，待接口恢复后直接重跑即可。');
          process.exit(EXIT.CATALOG_FAILED);
        }
        continue;
      }

      // page phase: all workers settled, driver waits for a decision
      // 页面阶段：所有任务结算完毕，驱动等待 retry / skip_all 决策
      if (p.waiting_retry && wf.includes('retry')) {
        const failed = (p.tasks || []).filter((t) => t.state === 'failed');
        const target = failed.find((t) => (pageRetries.get(t.id) || 0) < opts.pageRetries);
        if (target) {
          const n = (pageRetries.get(target.id) || 0) + 1;
          pageRetries.set(target.id, n);
          console.log(`[zread] retry page ${target.slug} (${n}/${opts.pageRetries}) / 重试页面`);
          send({ type: 'retry', params: { task_id: target.id } });
        } else if (opts.skipFailed) {
          console.log('[zread] retries exhausted -> skip_all (commits partial wiki, draft is deleted)');
          console.log('[zread] 重试耗尽 -> skip_all（提交残缺版本并删除草稿）');
          send({ type: 'skip_all', params: {} });
        } else {
          console.error(`[zread] PARTIAL: ${failed.length} page(s) still failing. Keeping the draft so you can resume with --draft resume.`);
          console.error('[zread] 保留草稿，稍后可用 --draft resume 续传（若接受缺失页，请加 --skip-failed）。');
          for (const f of failed) console.error(`         - ${f.slug}`);
          gracefulQuit();
          setTimeout(() => process.exit(EXIT.PARTIAL), 6000);
        }
      }
    }
  });

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (c) => { if (c.trim()) process.stderr.write(c); });

  // watchdog / 看门狗：长时间无任何事件 => 优雅退出，保留草稿
  const watchdog = setInterval(() => {
    if (exiting) return;
    if (Date.now() - lastEventAt > opts.idleTimeout * 1000) {
      console.error(`[zread] IDLE_TIMEOUT: no event for ${opts.idleTimeout}s -> graceful quit (draft kept).`);
      console.error('[zread] 空闲超时：已优雅退出，草稿保留，可用 --draft resume 续传。');
      gracefulQuit();
      setTimeout(() => process.exit(EXIT.IDLE_TIMEOUT), 6000);
    }
  }, 5000);

  process.on('SIGINT', () => {
    console.error('\n[zread] SIGINT -> graceful quit (draft kept, resume with --draft resume).');
    console.error('[zread] 已优雅退出，草稿保留，可用 --draft resume 续传。');
    clearInterval(watchdog);
    gracefulQuit();
    setTimeout(() => process.exit(EXIT.INTERRUPTED), 6000);
  });

  child.on('exit', (code, signal) => {
    clearInterval(watchdog);
    if (!exiting) {
      const p = lastVm.pages || {};
      const failed = (p.tasks || []).filter((t) => t.state === 'failed').length;
      if (failed) { console.error(`[zread] PARTIAL (child exited): ${failed} page(s) failed.`); process.exit(EXIT.PARTIAL); }
      console.error(`[zread] child exited unexpectedly (code=${code} signal=${signal}); draft kept if present.`);
      console.error('[zread] 子进程异常退出；若草稿仍在可用 --draft resume 续传。');
      process.exit(code === 0 ? EXIT.OK : EXIT.PARTIAL);
    }
  });
}

// ------------------------------------------------------------- main / 入口
const opts = parseArgs(process.argv.slice(2));
if (opts.help) { console.log(HELP); process.exit(0); }
if (opts.status) { printStatus(opts.cwd); process.exit(0); }
preflight(configPath());
run(opts);
