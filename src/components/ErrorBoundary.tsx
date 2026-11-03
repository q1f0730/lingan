// v0.20 全局错误兜底：组件抛错不再整屏白掉。
// - 外层（整个 App）：整页兜底，可「重试 / 重新载入 / 进安全模式 / 复制诊断信息」
// - 每个页面：只这一页出错，导航还在，可「重试 / 复制诊断信息」
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { logError, setSafeMode, isSafeMode } from '../lib/errlog';

export interface CopyDiag {
  (): Promise<string>;
}

interface Props {
  children: ReactNode;
  scope: 'app' | 'view';
  /** 页面名（写进日志） */
  name?: string;
  copyDiag: CopyDiag;
  /** 切换页面时重置 */
  resetKey?: string;
}
interface State {
  err: Error | null;
  copied: '' | 'ok' | 'fail';
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { err: null, copied: '' };

  static getDerivedStateFromError(err: Error): Partial<State> {
    return { err };
  }

  componentDidCatch(err: Error, info: ErrorInfo) {
    const e = err instanceof Error ? err : new Error(String(err));
    if (info.componentStack && !e.stack?.includes('ErrorBoundary')) e.stack = (e.stack || '') + '\n' + info.componentStack.split('\n').slice(0, 4).join('\n');
    logError(e, 'render', this.props.name ? { view: this.props.name } : {});
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.err) this.setState({ err: null, copied: '' });
  }

  private copy = async () => {
    let ok = false;
    try {
      ok = await copyText(await this.props.copyDiag());
    } catch {
      ok = false;
    }
    this.setState({ copied: ok ? 'ok' : 'fail' });
  };

  render() {
    const { err, copied } = this.state;
    if (!err) return this.props.children;
    const app = this.props.scope === 'app';
    const safe = isSafeMode();
    return (
      <section className={`crash ${app ? 'crash-app' : 'crash-view'}`} role="alert">
        <p className="crash-k meta-text">{app ? '拾穗出了点问题' : '出错'}</p>
        <h2 className="crash-title">{app ? '整个界面出错了' : '这一页出错了'}</h2>
        <p className="crash-msg meta-text">
          {app ? '你的穗都还在本机，没有丢。' : '其他页面照常能用，穗都还在。'}
          {safe ? '（现在是安全模式）' : ''}
        </p>
        <div className="crash-actions">
          <button className="btn primary crash-retry" onClick={() => this.setState({ err: null, copied: '' })}>
            重试
          </button>
          {app && (
            <button className="btn text crash-reload" onClick={() => location.reload()}>
              重新载入
            </button>
          )}
          {app && !safe && (
            <button
              className="btn text crash-safe"
              onClick={() => {
                setSafeMode(true);
                location.reload();
              }}
            >
              进安全模式
            </button>
          )}
          <button className="btn text crash-copy" onClick={this.copy}>
            {copied === 'ok' ? '已复制' : copied === 'fail' ? '复制失败' : '复制诊断信息'}
          </button>
        </div>
        <p className="crash-hint meta-text">诊断信息只含版本、平台、库条数和错误摘要，不含密钥和内容。</p>
      </section>
    );
  }
}
