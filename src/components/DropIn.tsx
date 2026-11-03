import { useEffect, useRef, useState } from 'react';
import { buildDrafts, dropSummary, isOutsideDrag, planTransfer, readTransfer } from '../lib/dropin';
import { compressImage } from '../lib/image';
import { useApp } from '../lib/store';
import { quickAdd } from './QuickBar';
import { notifyDupe } from '../lib/dupnotice';

export function isEditable(el: EventTarget | null): boolean {
  const e = el as HTMLElement | null;
  if (!e || !e.tagName) return false;
  return e.tagName === 'INPUT' || e.tagName === 'TEXTAREA' || e.tagName === 'SELECT' || e.isContentEditable;
}

/** 收一把粘贴 / 拖放（穗仓任意处、速记小窗共用） */
export async function takeTransfer(dt: DataTransfer | null, add: (d: Parameters<typeof quickAdd>[0]) => Promise<number>, caption?: string): Promise<{ ids: number[]; msg: string } | null> {
  const { t, files } = readTransfer(dt);
  const { steps, skipped } = planTransfer(t);
  if (!steps.length && !skipped) return null;
  const { drafts, failed } = await buildDrafts(steps, files, { compress: (f) => compressImage(f), readText: (f) => f.text(), caption });
  const ids: number[] = [];
  for (const d of drafts) ids.push(await add(d));
  return { ids, msg: dropSummary(ids.length, skipped, failed) };
}

/**
 * v0.27 0406 / 0407：穗仓任意位置 Ctrl+V 直接成穗；把图片、文件、网页链接拖进窗口任意处成穗。
 * 输入框里粘贴照旧；有弹层（详情、速记、确认框）时不接；页面里自己拖动的东西不算。
 */
export function DropIn({ blocked }: { blocked: boolean }) {
  const { settings, toast } = useApp();
  const [over, setOver] = useState(false);
  const internal = useRef(false);
  const depth = useRef(0);
  const ref = useRef({ blocked, settings, toast });
  ref.current = { blocked, settings, toast };

  useEffect(() => {
    const add = (d: Parameters<typeof quickAdd>[0]) => quickAdd(d, ref.current.settings, (m) => ref.current.toast(m, 'err'));
    const run = async (dt: DataTransfer | null) => {
      try {
        const r = await takeTransfer(dt, add);
        if (!r) return;
        ref.current.toast(r.msg, r.ids.length ? 'ok' : 'err');
        if (r.ids.length === 1) void notifyDupe(r.ids[0], ref.current.toast);
      } catch (e) {
        ref.current.toast('没拾进来：' + (e instanceof Error ? e.message : String(e)), 'err');
      }
    };
    const onPaste = (e: ClipboardEvent) => {
      if (ref.current.blocked || isEditable(e.target) || isEditable(document.activeElement)) return;
      const { t } = readTransfer(e.clipboardData);
      if (!t.files.length && !t.text.trim() && !t.uris.length) return;
      e.preventDefault();
      void run(e.clipboardData);
    };
    const onStart = () => (internal.current = true);
    const onEnd = () => (internal.current = false);
    const outside = (e: DragEvent) => !ref.current.blocked && isOutsideDrag(e.dataTransfer?.types ? Array.from(e.dataTransfer.types) : null, internal.current);
    const onEnter = (e: DragEvent) => {
      if (!outside(e)) return;
      e.preventDefault();
      depth.current++;
      setOver(true);
    };
    const onOver = (e: DragEvent) => {
      if (!outside(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const onLeave = (e: DragEvent) => {
      if (!outside(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (!depth.current) setOver(false);
    };
    const onDrop = (e: DragEvent) => {
      const was = outside(e);
      depth.current = 0;
      setOver(false);
      internal.current = false;
      if (!was) return;
      // 拖进输入框的文字交给输入框自己
      if (isEditable(e.target) && !(e.dataTransfer?.files?.length)) return;
      e.preventDefault();
      void run(e.dataTransfer);
    };
    window.addEventListener('paste', onPaste);
    document.addEventListener('dragstart', onStart);
    document.addEventListener('dragend', onEnd);
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('paste', onPaste);
      document.removeEventListener('dragstart', onStart);
      document.removeEventListener('dragend', onEnd);
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  if (!over) return null;
  return (
    <div className="dropin" role="status" aria-live="polite">
      <div className="dropin-box">
        <b>松手就拾进穗仓</b>
        <span className="meta-text">图片、链接、文字、.txt / .md 都行</span>
      </div>
    </div>
  );
}
