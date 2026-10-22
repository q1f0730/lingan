import { useEffect, useRef } from 'react';
import { mountField, type FieldHandle } from '../lib/field/mount';
import type { Phase } from '../lib/phases';

/** 全屏活的 ASCII 麦田（页面背后）。still = 一帧静止画面；lite = 低端机降级。 */
export function Field({ phase, still, lite }: { phase: Phase; still: boolean; lite: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const handle = useRef<FieldHandle | null>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    try {
      handle.current = mountField(cv, { phase: phaseRef.current, still, lite });
    } catch {
      handle.current = null; // 没有 canvas 也不影响使用
    }
    return () => {
      handle.current?.destroy();
      handle.current = null;
    };
  }, [still, lite]);

  useEffect(() => {
    handle.current?.setPhase(phase);
  }, [phase]);

  return (
    <div className="wheatfield" aria-hidden>
      <div className="field-sky" />
      <canvas ref={ref} className="field-canvas" data-mode={still ? 'still' : 'live'} />
    </div>
  );
}
