// v0.25 桌面版启动后（空闲时才加载）：按设置开本地 API、接 Rust 转来的请求；顺带每天一次的更新检查。
// 网页版 / e2e 不加载这块（App.tsx 只在 Tauri 里 import）。
import { addItem, db } from './db';
import { apiStart, apiStop, apiSupported, listenApi, onAgentCfg, readAgentCfg } from './agent';
import { handleApi, type AgentDraft } from './agentapi';
import { autoCheck } from './updatecheck';
import type { ConfirmOpts } from './store';

type Toast = (msg: string, kind?: 'ok' | 'err', action?: { label: string; run: () => void }) => void;
const TYPE_LABEL: Record<string, string> = { music: '音乐', film: '影视', text: '文字', link: '链接', idea: '想法', image: '图片' };

export function draftSummary(client: string, d: AgentDraft): string {
  const lines = [`来自：${client || '未知客户端'}`, `类型：${TYPE_LABEL[d.type] || d.type}`, `标题：${d.title}`];
  if (d.creator) lines.push(`作者：${d.creator}`);
  if (d.url) lines.push(`链接：${d.url}`);
  if (d.content) lines.push(`内容：${d.content.slice(0, 160)}${d.content.length > 160 ? '…' : ''}`);
  if (d.why) lines.push(`为什么：${d.why.slice(0, 120)}`);
  if (d.tags.length) lines.push(`标签：${d.tags.join(' ')}`);
  lines.push('', '允许后进「待理」，标「Agent 代拾」。');
  return lines.join('\n');
}

export async function boot(opts: { toast: Toast; confirm: (o: ConfirmOpts) => Promise<boolean>; version: string }): Promise<() => void> {
  const offs: Array<() => void> = [];
  if (apiSupported()) {
    const { invoke } = await import('@tauri-apps/api/core');
    const confirmWrite = async (client: string, d: AgentDraft) => {
      void invoke('api_focus').catch(() => {});
      const ask = opts.confirm({ title: `${client || 'Agent'} 想代拾一穗`, body: draftSummary(client, d), ok: '允许', cancel: '拒绝' });
      const timeout = new Promise<boolean>((r) => setTimeout(() => r(false), 170000));
      const yes = await Promise.race([ask, timeout]);
      if (yes) opts.toast('Agent 代拾的一穗已进待理');
      return yes;
    };
    offs.push(
      await listenApi((e) =>
        handleApi(e, {
          db,
          version: opts.version,
          canWrite: () => readAgentCfg().write,
          confirmWrite,
          addItem: (data) => addItem(data, db, { inbox: true }),
        }),
      ),
    );
    let last = readAgentCfg();
    const apply = async (on: boolean, port: number) => {
      try {
        if (on) await apiStart(port);
        else await apiStop();
      } catch (e) {
        opts.toast(`本地 API 开不了：${String(e)}`, 'err');
      }
    };
    if (last.on) void apply(true, last.port);
    offs.push(
      onAgentCfg((c) => {
        if (c.on !== last.on || c.port !== last.port) void apply(c.on, c.port);
        last = c;
      }),
    );
  }
  void autoCheck(opts.version, opts.toast).catch(() => {});
  return () => offs.forEach((f) => f());
}
