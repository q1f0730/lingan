// v0.36 ROADMAP「说一句就收」：速记条上的「说」——只用系统自带的语音识别，不往安装包 / 首屏塞模型。
// - 安卓：按住说话、松手成一穗。原生 LinganVoice 桥（scripts/android/GleanVoice.kt）用系统 SpeechRecognizer；
//   手机没有识别服务时退回系统语音输入框（RecognizerIntent），都没有就明说。
// - Windows：点一下 = 把焦点放进速记框再按 Win+H（系统语音输入），字直接打进框里，说完回车存。
// 懒加载：只在按下「说」时 import。
import { isTauriEnv } from './desktop';

export interface VoiceBridge {
  /** 开始听：listening = 在听；perm = 刚弹了麦克风权限框；dialog = 打开了系统语音框；none = 这台手机没有语音识别 */
  start(): string;
  stop(): void;
  /** {"state":"idle|listening|done|error","text":"…","err":7} */
  poll(): string;
}

export function voiceBridge(w: unknown = typeof window === 'undefined' ? undefined : window): VoiceBridge | null {
  const b = (w as { LinganVoice?: VoiceBridge } | undefined)?.LinganVoice;
  return b && typeof b.start === 'function' ? b : null;
}

/** 速记条要不要显示「说」：安卓有桥，或桌面版（Windows 听写） */
export function hasVoice(w: unknown = typeof window === 'undefined' ? undefined : window): boolean {
  return !!voiceBridge(w) || (isTauriEnv(w) && !('LinganShare' in (w as object)));
}

/** SpeechRecognizer.ERROR_* → 人话。断网要说清楚，不能卡住 */
export function voiceErr(code: number): string {
  if (code === 1 || code === 2 || code === 4 || code === 11) return '没网：系统语音识别要联网，这句没收（可以打字）';
  if (code === 6 || code === 7) return '没听清，再按住说一次';
  if (code === 9) return '没有麦克风权限：系统设置 → 应用 → 拾穗 → 权限 里打开';
  if (code === 8) return '语音识别正忙，稍后再试';
  if (code === 12 || code === 13) return '系统语音识别不支持中文';
  return `语音识别出错（${code}）`;
}

interface Poll {
  state: string;
  text?: string;
  err?: number;
}
function readPoll(b: VoiceBridge): Poll {
  try {
    return JSON.parse(b.poll()) as Poll;
  } catch {
    return { state: 'error', err: 5 };
  }
}

let mode: '' | 'hold' | 'dialog' = '';
let onText: ((t: string) => void) | null = null;
let onErr: ((m: string) => void) | null = null;

async function wait(b: VoiceBridge, ms: number): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    await new Promise((r) => setTimeout(r, 150));
    const p = readPoll(b);
    if (p.state === 'done') {
      const t = (p.text || '').trim();
      mode = '';
      return void (t ? onText?.(t) : onErr?.(voiceErr(7)));
    }
    if (p.state === 'error') {
      mode = '';
      return void onErr?.(voiceErr(p.err ?? 5));
    }
  }
  mode = '';
  onErr?.('等太久了，这句没收');
}

/** 按下「说」 */
export async function hold(input: HTMLInputElement | null, text: (t: string) => void, err: (m: string) => void): Promise<void> {
  onText = text;
  onErr = err;
  const b = voiceBridge();
  if (b) {
    const r = b.start();
    if (r === 'listening') mode = 'hold';
    else if (r === 'dialog') {
      mode = 'dialog';
      void wait(b, 60000);
    } else if (r === 'perm') err('要用麦克风：允许后再按住「说」');
    else err('这台手机没有系统语音识别（可以装讯飞 / 百度输入法，用键盘上的话筒）');
    return;
  }
  if (!isTauriEnv()) return;
  input?.focus();
  const { invoke } = await import('@tauri-apps/api/core');
  const ok = await invoke<boolean>('dictate').catch(() => false);
  if (!ok) err('没能打开 Windows 语音输入，可以自己按 Win+H');
}

/** 松开「说」：安卓停止收音、等结果（最多 8 秒） */
export async function letGo(): Promise<void> {
  const b = voiceBridge();
  if (!b || mode !== 'hold') return;
  b.stop();
  await wait(b, 8000);
}
