import { m } from 'framer-motion';
import { IconMoon, IconSun } from './icons';
import { SPRING } from './MotionRoot';

/**
 * Rewamp「Theme Toggle」移植：轨道 + 滑动圆钮，钮里的太阳 / 月亮交叉淡入。
 * 桌面侧栏底部一键在白 / 黑之间切（设置里仍可选「跟随系统」）。
 */
export function ThemeToggle({ dark, onChange }: { dark: boolean; onChange: (dark: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={dark} aria-label={dark ? '换成白色主题' : '换成黑色主题'} className={`rw-theme${dark ? ' dark' : ''}`} onClick={() => onChange(!dark)}>
      <span className="rw-theme-g sun" aria-hidden>
        <IconSun size={12} />
      </span>
      <span className="rw-theme-g moon" aria-hidden>
        <IconMoon size={12} />
      </span>
      <m.span className="rw-theme-knob" animate={{ x: dark ? 26 : 0 }} transition={SPRING} aria-hidden>
        {dark ? <IconMoon size={12} /> : <IconSun size={12} />}
      </m.span>
    </button>
  );
}
