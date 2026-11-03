import { useEffect, useRef, useState } from 'react';
import { LOCAL_SERVERS, normalizeHost, probeLocal, suggestModels, chatModels, embedModels, type ProbeResult } from '../lib/localmodel';
import type { Settings } from '../lib/settings';

/**
 * v0.24 0208 / 0209 本地模型：一键探测本机的 LM Studio（1234）/ Ollama（11434），列出模型点一下就用；
 * 手机上填电脑的局域网 IP，同样探测、同样选模型。不要密钥，不联网也能用。
 * 只改草稿设置（s），保存仍由设置页的「保存」按钮做。
 */
export function LocalModelPanel({ s, setS, auto, desktop }: { s: Settings; setS: (f: (x: Settings) => Settings) => void; auto?: boolean; desktop?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<ProbeResult[] | null>(null);
  const [host, setHost] = useState(s.localHost || '');
  const [hostErr, setHostErr] = useState('');
  const ran = useRef(false);

  async function scan(hosts: string[]) {
    setBusy(true);
    try {
      setRes(await probeLocal(hosts));
    } finally {
      setBusy(false);
    }
  }
  // 电脑上第一次打开设置、还没配 AI：自动探测一次本机（Windows 端默认推荐本地模型）
  useEffect(() => {
    if (!auto || ran.current) return;
    ran.current = true;
    void scan(['127.0.0.1']);
  }, [auto]);

  function scanHost() {
    const ok = LOCAL_SERVERS.some((k) => normalizeHost(host, k.kind));
    if (!ok) {
      setHostErr('只能填本机或局域网地址，例如 192.168.1.23（不要公网地址）');
      return;
    }
    setHostErr('');
    setS((x) => ({ ...x, localHost: host.trim() }));
    void scan([host.trim()]);
  }

  function use(r: ProbeResult, model?: string) {
    const sug = suggestModels(r.models);
    setS((x) => ({
      ...x,
      preset: 'local',
      chat: { ...x.chat, baseUrl: r.baseUrl, chatModel: model || sug.chat, visionModel: sug.vision, apiKey: x.preset === 'local' ? x.chat.apiKey : '', extraBody: '' },
      embed: sug.embed ? { ...x.embed, sameAsChat: true, baseUrl: '', model: sug.embed } : x.embed,
    }));
  }

  const found = (res || []).filter((r) => r.ok);
  return (
    <div className="local-panel" data-found={found.length}>
      <div className="local-head">
        <span className="label">本地模型</span>
        <span className="meta-text">{desktop ? 'LM Studio / Ollama 跑在这台电脑上：不要密钥、断网也能嫁接、素材不出门。' : '手机可以用电脑上的模型：填电脑的局域网 IP（同一个 Wi-Fi）。'}</span>
      </div>
      <div className="actions text-actions">
        <button type="button" className="btn text strong local-probe" onClick={() => scan(['127.0.0.1'])} disabled={busy}>
          {busy ? '探测中…' : '探测本机'}
        </button>
      </div>
      <div className="field local-host">
        <span className="label">电脑地址（手机用，局域网）</span>
        <div className="inline">
          <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="192.168.1.23 或 my-pc.local" inputMode="url" aria-label="电脑地址" onKeyDown={(e) => e.key === 'Enter' && scanHost()} />
          <button type="button" className="btn text local-probe-host" onClick={scanHost} disabled={busy || !host.trim()}>
            探测这台电脑
          </button>
        </div>
        {hostErr && <span className="error local-err">{hostErr}</span>}
      </div>
      {res && (
        <div className="table local-results">
          {res.map((r) => (
            <div key={r.origin + r.kind} className={`trow static local-row${r.ok ? ' ok' : ' off'}`} data-kind={r.kind}>
              <span className="tc tc-title">
                <b>{r.name}</b> <span className="dim num">{r.origin.replace(/^https?:\/\//, '')}</span>
              </span>
              {r.ok ? (
                <span className="tc local-models">
                  {chatModels(r.models).length ? (
                    chatModels(r.models)
                      .slice(0, 8)
                      .map((m) => (
                        <button key={m} type="button" className={`chip local-model${s.chat.baseUrl === r.baseUrl && s.chat.chatModel === m ? ' on' : ''}`} onClick={() => use(r, m)}>
                          {m}
                        </button>
                      ))
                  ) : (
                    <span className="meta-text">连上了，但还没加载模型：先在 {r.name} 里下载 / 加载一个。</span>
                  )}
                  {embedModels(r.models).length > 0 && <span className="meta-text"> · 向量：{embedModels(r.models)[0]}</span>}
                  <span className="dim num"> · {r.ms}ms</span>
                </span>
              ) : (
                <span className="tc meta-text local-why">{r.error}</span>
              )}
            </div>
          ))}
          {!found.length && (
            <ul className="local-tips meta-text">
              {LOCAL_SERVERS.map((k) => (
                <li key={k.kind}>
                  <b>{k.name}</b>：{k.lanTip}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {s.preset === 'local' && (
        <label className="check private-local">
          <input type="checkbox" checked={!!s.privateLocal} onChange={(e) => setS((x) => ({ ...x, privateLocal: e.target.checked }))} /> 私密穗也可以发给本地模型（只在接口是本机 / 局域网时生效；云端永远不发）
        </label>
      )}
    </div>
  );
}
