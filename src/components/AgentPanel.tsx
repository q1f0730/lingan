import { useEffect, useState } from 'react';
import { AGENT_DEFAULT, apiRotate, apiStart, apiStatus, apiStop, apiSupported, apiToken, claudeCodeCmd, httpConfig, mcpUrl, onAgentCfg, readAgentCfg, stdioConfig, validPort, writeAgentCfg, type AgentCfg, type ApiStatus } from '../lib/agent';
import { clearAudit, onAudit, readAudit, weekSummary } from '../lib/apiaudit';
import { copyText } from './ErrorBoundary';
import { useApp } from '../lib/store';

const MCP_SCRIPT = 'https://github.com/q1f0730/lingan/releases/latest/download/glean-mcp.mjs';
const TOOL_LABEL: Record<string, string> = {
  search_items: '搜穗',
  get_item: '读穗',
  list_branches: '列新枝',
  get_taste: '口味侧写',
  'resource:taste': '口味侧写',
  check_cliches: '查套路',
  add_item: '代拾一穗',
};

function hm(t: number) {
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** v0.25 设置 → Agent 与 API：本地 API 开关、令牌、允许写入、接入说明、谁看过我的穗仓（0806 0807 0838） */
export function AgentPanel() {
  const { toast, confirm } = useApp();
  const ok = apiSupported();
  const [cfg, setCfg] = useState<AgentCfg>(() => readAgentCfg());
  const [st, setSt] = useState<ApiStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [audit, setAudit] = useState(() => readAudit());
  const [portText, setPortText] = useState(String(cfg.port));

  useEffect(() => onAgentCfg(setCfg), []);
  useEffect(() => onAudit(() => setAudit(readAudit())), []);
  useEffect(() => {
    if (ok) apiStatus().then(setSt, () => setSt(null));
  }, [ok, cfg.on]);

  async function toggleApi() {
    if (!ok || busy) return;
    setBusy(true);
    try {
      if (cfg.on) {
        setSt(await apiStop());
        writeAgentCfg({ ...cfg, on: false });
        toast('本地 API 已关');
      } else {
        const s = await apiStart(cfg.port);
        setSt(s);
        writeAgentCfg({ ...cfg, on: true });
        toast(`本地 API 已开 · 只听 127.0.0.1:${s.port}`);
      }
    } catch (e) {
      toast(`开不了：${String(e)}（端口被占用就换一个）`, 'err');
    } finally {
      setBusy(false);
    }
  }

  async function toggleWrite() {
    if (cfg.write) {
      writeAgentCfg({ ...cfg, write: false });
      toast('已关：Agent 只能读');
      return;
    }
    const yes = await confirm({
      title: '允许 Agent 写入？',
      body: '打开后 Agent 多一个「代拾一穗」工具。每一次写入都会在这里弹窗等你点「允许」；收下的穗进待理、标「Agent 代拾」，不会直接进穗仓。随时可以关。',
      ok: '允许写入',
      cancel: '保持只读',
    });
    if (yes) {
      writeAgentCfg({ ...cfg, write: true });
      toast('已允许写入 · 每次仍要你确认');
    }
  }

  async function savePort() {
    const p = validPort(portText);
    setPortText(String(p));
    if (p === cfg.port) return;
    const next = { ...cfg, port: p };
    writeAgentCfg(next);
    if (cfg.on && ok) {
      try {
        setSt(await apiStart(p));
        toast(`已换到端口 ${p}`);
      } catch (e) {
        toast(`端口 ${p} 开不了：${String(e)}`, 'err');
      }
    }
  }

  async function copyWith(make: (token: string) => string, what: string) {
    try {
      const t = ok ? await apiToken() : '<令牌>';
      if (!(await copyText(make(t)))) throw new Error('copy');
      toast(ok ? `已复制${what}（含令牌，别发给别人）` : `已复制${what}（令牌在 Windows 版里取）`);
    } catch {
      toast('复制失败', 'err');
    }
  }

  async function rotate() {
    const yes = await confirm({ title: '换一个令牌？', body: '旧令牌立刻失效，已经接好的 Claude Code / Cherry Studio 要用新令牌重新配一次。', ok: '换', cancel: '算了', danger: true });
    if (!yes) return;
    try {
      setSt(await apiRotate());
      toast('令牌已更换');
    } catch (e) {
      toast(`换不了：${String(e)}`, 'err');
    }
  }

  const week = weekSummary(audit);
  const recent = audit.slice(-8).reverse();
  const port = cfg.port || AGENT_DEFAULT.port;
  return (
    <section className="set-sec agent-panel" id="set-agent">
      <h2 className="sec-title">Agent 与 API</h2>
      <p className="meta-text">让 Claude Code、Cherry Studio 这类 Agent 读你的穗仓：搜穗、读穗、列新枝、口味侧写、查套路。默认只读；私密穗永远不给。只听本机 127.0.0.1，要带令牌，令牌存在系统钥匙串里。</p>
      {!ok && <p className="meta-text agent-na">本地 API 只有 Windows 版有（手机和网页版没有能常驻的本机端口）。在电脑上装拾穗后到这里打开。</p>}
      <div className="table action-table">
        <button className="trow cap-switch agent-api" role="switch" aria-checked={cfg.on} onClick={toggleApi} disabled={!ok || busy}>
          <span className="tc tc-title">本地 API</span>
          <span className="tc tc-src">{st?.running ? `在听 127.0.0.1:${st.port}${st.stored === 'memory' ? ' · 钥匙串不可用，令牌只在内存里' : ''}` : '关着时任何程序都连不上'}</span>
          <span className="tc tc-date">{busy ? '…' : cfg.on ? '开' : '关'}</span>
        </button>
        <button className="trow cap-switch agent-write" role="switch" aria-checked={cfg.write} onClick={toggleWrite}>
          <span className="tc tc-title">允许 Agent 写入</span>
          <span className="tc tc-src">每次弹窗确认 · 进待理、标「Agent 代拾」</span>
          <span className="tc tc-date">{cfg.write ? '允许' : '只读'}</span>
        </button>
        {ok && (
          <>
            <button className="trow agent-copy-token" onClick={() => copyWith((t) => t, '令牌')}>
              <span className="tc tc-title">复制令牌</span>
              <span className="tc tc-src">只在你点的时候从钥匙串里取</span>
              <span className="tc tc-date" />
            </button>
            <button className="trow agent-rotate" onClick={rotate}>
              <span className="tc tc-title">换一个令牌</span>
              <span className="tc tc-src">怀疑泄露时用：旧令牌立即失效</span>
              <span className="tc tc-date" />
            </button>
          </>
        )}
      </div>
      <label className="field agent-port">
        <span className="label">端口</span>
        <input inputMode="numeric" value={portText} onChange={(e) => setPortText(e.target.value.replace(/\D/g, '').slice(0, 5))} onBlur={savePort} aria-label="本地 API 端口" />
      </label>

      <h3 className="sub-title">接入</h3>
      <dl className="kv agent-howto">
        <div>
          <dt>Claude Code</dt>
          <dd>
            <code className="agent-snippet">{claudeCodeCmd(port)}</code>
            <button className="btn text agent-copy-cc" onClick={() => copyWith((t) => claudeCodeCmd(port, t), '命令')}>
              复制命令
            </button>
          </dd>
        </div>
        <div>
          <dt>Cherry Studio</dt>
          <dd>
            设置 → MCP 服务器 → 添加 → 类型选「可流式传输的 HTTP」，URL 填 <code className="agent-snippet">{mcpUrl(port)}</code>，请求头加 <code className="agent-snippet">Authorization: Bearer 令牌</code>；或者「从 JSON 导入」：
            <button className="btn text agent-copy-json" onClick={() => copyWith((t) => httpConfig(port, t), ' JSON')}>
              复制 JSON
            </button>
          </dd>
        </div>
        <div>
          <dt>只支持 stdio 的客户端</dt>
          <dd>
            下载 <a href={MCP_SCRIPT} target="_blank" rel="noreferrer">glean-mcp.mjs</a>（单文件、零依赖，需要 Node 18+），配置里 command 填 node：
            <button className="btn text agent-copy-stdio" onClick={() => copyWith((t) => stdioConfig(port, t), '配置')}>
              复制配置
            </button>
          </dd>
        </div>
        <div>
          <dt>REST</dt>
          <dd>
            <code className="agent-snippet">GET /v1/items?q=夜 · /v1/items/&lt;id&gt; · /v1/branches · /v1/taste · POST /v1/cliches/check</code>
          </dd>
        </div>
      </dl>

      <h3 className="sub-title">谁看过我的穗仓 · 近 7 天</h3>
      {week.length === 0 ? (
        <p className="meta-text agent-audit-empty">还没有 Agent 来过。</p>
      ) : (
        <dl className="kv agent-audit">
          {week.map((w) => (
            <div key={w.client}>
              <dt>{w.client}</dt>
              <dd className="num">
                {w.calls} 次 · 看过 {w.items} 穗{w.writes ? ` · 代拾 ${w.writes} 穗` : ''} · 最后 {hm(w.last)}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {recent.length > 0 && (
        <>
          <ol className="agent-recent meta-text">
            {recent.map((r, i) => (
              <li key={i} className={r.ok ? '' : 'err'}>
                {hm(r.t)} · {r.client} · {TOOL_LABEL[r.tool] || r.tool}
                {r.n ? ` · ${r.n} 穗` : ''}
                {r.ok ? '' : ' · 被拒 / 失败'}
              </li>
            ))}
          </ol>
          <button
            className="btn text agent-audit-clear"
            onClick={() => {
              clearAudit();
              toast('访问记录已清空');
            }}
          >
            清空访问记录
          </button>
        </>
      )}
    </section>
  );
}
