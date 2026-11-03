import { m } from 'framer-motion';
import type { ComponentType } from 'react';
import type { View } from '../../lib/store';
import { IconGrid, IconHeart, IconMerge, IconSliders, IconSprout } from './icons';
import { SPRING } from './MotionRoot';

export const NAV: Array<{ v: View; label: string; Icon: ComponentType<{ size?: number }>; key: string }> = [
  { v: 'library', label: '穗仓', Icon: IconGrid, key: '1' },
  { v: 'develop', label: '嫁接', Icon: IconMerge, key: '2' },
  { v: 'branches', label: '新枝', Icon: IconSprout, key: '3' },
  { v: 'taste', label: '口味', Icon: IconHeart, key: '4' },
  { v: 'settings', label: '设置', Icon: IconSliders, key: ',' },
];

/**
 * 主导航。
 * - 手机 `layout="dock"`：Rewamp「Morphing Tab Navbar」移植——白色浮起胶囊，选中项下面一块会滑动的底（layoutId 弹簧）。
 *   五项都显示图标 + 中文，图标 20px、文字 11px，拇指够得着。
 * - 桌面 `layout="side"`：Rewamp「Sidebar」（Animated Dock Sidebar）移植——竖排，选中项淡紫底 + 左侧小竖条一起滑动；
 *   因为中文导航需要读得出来，这里把原组件的纯图标 + 悬停提示改成图标 + 文字常显，快捷键放在右侧小字。
 */
export function NavBar({ view, go, layout }: { view: View; go: (v: View) => void; layout: 'dock' | 'side' }) {
  return (
    <nav className={`nav nav-${layout}`} aria-label="主导航">
      {NAV.map(({ v, label, Icon, key }) => {
        const on = view === v;
        return (
          <button key={v} className={`nav-btn${on ? ' on' : ''}`} onClick={() => go(v)} aria-current={on ? 'page' : undefined} data-view={v}>
            {on && <m.span layoutId={`nav-bubble-${layout}`} className="nav-bubble" transition={SPRING} aria-hidden />}
            {on && layout === 'side' && <m.span layoutId="nav-pip" className="nav-pip" transition={SPRING} aria-hidden />}
            <span className="nav-ico">
              <Icon size={layout === 'side' ? 19 : 20} />
            </span>
            <span className="nav-label">{label}</span>
            {layout === 'side' && <kbd className="nav-key">Alt {key === ',' ? ',' : key}</kbd>}
          </button>
        );
      })}
    </nav>
  );
}
