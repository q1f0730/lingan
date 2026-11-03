// v0.38 体积：Framer Motion（首包约 42KB + 首屏后再加载 37KB）换成这个约 2KB 的自写版——只实现拾穗用到的那一小部分：
// m.div / m.span / m.line 的 initial → animate（进场）、animate 变化（状态切换）、AnimatePresence 的 exit（退场），
// 动画走浏览器自带的 Element.animate（WAAPI，transform / opacity / filter 在合成线程跑）。
// - 元素的 style 直接写最终状态，动画只是盖在上面的一层：没动画、动画被取消、减少动态效果时都停在最终状态。
// - 和以前的 LazyMotion 一样：首屏画完之前不播进场动画（第一帧直接是最终状态，不拖冷启动）。
// - 弹簧按阻尼换算成时长 + 缓出曲线（不过冲）；关键帧数组、times、repeat、delay、ease 数组都认。
import { Children, createContext, createElement, forwardRef, Fragment, isValidElement, useContext, useLayoutEffect, useRef, useState, type CSSProperties, type ReactElement, type ReactNode, type Ref } from 'react';

type Val = number | string | Array<number | string> | Trans;
type Target = Record<string, Val> & { transition?: Trans };
type Trans = { type?: string; stiffness?: number; damping?: number; duration?: number; delay?: number; ease?: string | number[]; repeat?: number; times?: number[] } & Record<string, unknown>;
interface MProps {
  initial?: Target | false;
  animate?: Target;
  exit?: Target;
  transition?: Trans;
  style?: CSSProperties;
  [k: string]: unknown;
}

let painted = false;
/** 首屏画完之后才开始播动画（MotionRoot 调） */
export const motionReady = () => (painted = true);
export const ReducedCtx = createContext(false);
const PresenceCtx = createContext<null | (() => void)>(null);

const TF = ['x', 'y', 'scale', 'scaleX', 'scaleY', 'rotate'];
const last = (v: Val | undefined) => (Array.isArray(v) ? v[v.length - 1] : v);
/** 一组目标值 → CSS（transform 合成一条） */
function css(t: Target | undefined, at: (v: Val | undefined) => Val | undefined = last): Record<string, string | number> {
  const o: Record<string, string | number> = {};
  if (!t) return o;
  const g = (k: string) => at(t[k]);
  if (TF.some((k) => t[k] !== undefined)) {
    const n = (k: string, d: number) => (g(k) ?? d) as number;
    o.transform = `translate(${n('x', 0)}px,${n('y', 0)}px) rotate(${n('rotate', 0)}deg) scale(${n('scaleX', n('scale', 1))},${n('scaleY', n('scale', 1))})`;
  }
  if (t.opacity !== undefined) o.opacity = g('opacity') as number;
  if (t.filter !== undefined) o.filter = g('filter') as string;
  return o;
}
function timing(tr: Trans = {}): KeyframeAnimationOptions {
  const spring = tr.type === 'spring' || (tr.duration == null && tr.ease == null);
  const e = tr.ease;
  return {
    duration: (spring ? Math.min(0.6, Math.max(0.2, 8 / (tr.damping || 26))) : (tr.duration ?? 0.3)) * 1000,
    delay: (tr.delay || 0) * 1000,
    easing: Array.isArray(e) ? `cubic-bezier(${e.join(',')})` : e === 'easeOut' ? 'ease-out' : e === 'easeIn' ? 'ease-in' : e === 'linear' ? 'linear' : 'cubic-bezier(.22,1,.36,1)',
    iterations: tr.repeat === Infinity ? Infinity : (tr.repeat || 0) + 1,
  };
}

const own = new WeakMap<Element, Animation[]>();
function run(el: Element, from: Target | undefined, to: Target, tr: Trans | undefined, done?: () => void) {
  for (const a of own.get(el) || []) a.cancel();
  if (!el.animate) return done?.();
  const mine: Animation[] = [];
  own.set(el, mine);
  const keys = Object.keys(to).filter((k) => k !== 'transition');
  // 每个属性可以有自己的 transition（{ opacity: { repeat… }, scaleY: {…} }）：按属性分组各跑一个动画
  const groups = new Map<Trans | undefined, string[]>();
  for (const k of keys) {
    const own = (tr?.[k] as Trans | undefined) || tr;
    groups.set(own, [...(groups.get(own) || []), k]);
  }
  let left = groups.size;
  for (const [t, ks] of groups) {
    const pick = (s: Target | undefined) => (s ? Object.fromEntries(ks.filter((k) => s[k] !== undefined).map((k) => [k, s[k]])) : undefined) as Target | undefined;
    const tv = pick(to)!;
    const arr = ks.find((k) => Array.isArray(to[k]));
    let frames: Keyframe[];
    if (arr) {
      const n = (to[arr] as Val[]).length;
      frames = Array.from({ length: n }, (_, i) => ({ ...css(tv, (v) => (Array.isArray(v) ? v[i] : v)), ...(t?.times ? { offset: t.times[i] } : {}) }));
    } else frames = [css({ ...tv, ...pick(from) }), css(tv)];
    const a = el.animate(frames, timing(t));
    mine.push(a);
    a.onfinish = a.oncancel = () => void (--left || done?.());
  }
  if (!left) done?.();
}

const cache: Record<string, unknown> = {};
function make(tag: string) {
  return forwardRef(function M({ initial, animate, exit, transition, style, ...rest }: MProps, ref: Ref<Element>) {
    const el = useRef<Element | null>(null);
    const reduced = useContext(ReducedCtx);
    const leave = useContext(PresenceCtx);
    const prev = useRef<Target | undefined>(undefined);
    const key = JSON.stringify(animate);
    useLayoutEffect(() => {
      const from = prev.current ?? (initial === false ? undefined : initial);
      prev.current = animate;
      if (el.current && animate && from && painted && !reduced && !leave) run(el.current, from, animate, transition);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]);
    useLayoutEffect(() => {
      if (!leave) return;
      if (el.current && exit && painted && !reduced) run(el.current, animate, exit, exit.transition || transition, leave);
      else leave();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [leave]);
    const setRef = (n: Element | null) => {
      el.current = n;
      if (typeof ref === 'function') ref(n);
      else if (ref) (ref as { current: Element | null }).current = n;
    };
    return createElement(tag, { ...rest, ref: setRef, style: { ...style, ...css(leave && exit ? exit : animate) } });
  });
}
type MComp = (p: MProps & { children?: ReactNode }) => ReactElement;
export const m = new Proxy({} as Record<string, MComp>, { get: (_, k: string) => (cache[k] ||= make(k)) });

/** 退场：被拿掉的子元素先留着，等它的 exit 动画播完再真正移除 */
export function AnimatePresence({ children }: { children: ReactNode; initial?: boolean }) {
  const now = Children.toArray(children).filter(isValidElement);
  const [, force] = useState(0);
  const [st] = useState(() => ({ prev: [] as ReactElement[], gone: new Map<unknown, { el: ReactElement; done: () => void }>() }));
  const keys = new Set(now.map((c) => c.key));
  for (const c of st.prev)
    if (!keys.has(c.key) && !st.gone.has(c.key))
      st.gone.set(c.key, {
        el: c,
        done: () => {
          st.gone.delete(c.key);
          force((n) => n + 1);
        },
      });
  for (const k of [...st.gone.keys()]) if (keys.has(k as string)) st.gone.delete(k);
  st.prev.splice(0, st.prev.length, ...now);
  return createElement(Fragment, null, now, [...st.gone.values()].map((g) => createElement(PresenceCtx.Provider, { key: g.el.key, value: g.done }, g.el)));
}
