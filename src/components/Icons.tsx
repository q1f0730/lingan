// 细线图标（24×24，currentColor）。手画，和麦田一个气质。
import type { SVGProps } from 'react';

const base = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

/** 穗仓：一束麦穗 */
export const IcSheaf = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p} aria-hidden>
    <path d="M12 21V8" />
    <path d="M12 8c-1.6-1-2.2-2.6-2-4.5 1.6.8 2.3 2.4 2 4.5z" />
    <path d="M12 8c1.6-1 2.2-2.6 2-4.5-1.6.8-2.3 2.4-2 4.5z" />
    <path d="M12 12.5c-1.8-.6-2.9-2-3.1-3.9 1.8.4 2.9 1.8 3.1 3.9zM12 12.5c1.8-.6 2.9-2 3.1-3.9-1.8.4-2.9 1.8-3.1 3.9z" />
    <path d="M12 17c-1.8-.6-2.9-2-3.1-3.9 1.8.4 2.9 1.8 3.1 3.9zM12 17c1.8-.6 2.9-2 3.1-3.9-1.8.4-2.9 1.8-3.1 3.9z" />
  </svg>
);

/** 嫁接：两根枝在一处接上 */
export const IcGraft = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p} aria-hidden>
    <path d="M12 21v-7" />
    <path d="M12 14c-3-1-5-3.5-6-8" />
    <path d="M12 14c3-1 5-3.5 6-8" />
    <path d="M10.6 13.2l2.8 1.6" />
    <path d="M6 6c1.5-.2 2.6.4 3 1.8M18 6c-1.5-.2-2.6.4-3 1.8" />
  </svg>
);

/** 新枝：一根抽出新叶的枝 */
export const IcSprout = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p} aria-hidden>
    <path d="M12 21c0-5 0-8 1-11" />
    <path d="M13 10c.5-3.5 3-5.5 6.5-5.5-.3 3.6-2.8 5.6-6.5 5.5z" />
    <path d="M12.3 14c-.6-2.6-2.6-4-5.6-4 .3 2.7 2.3 4.1 5.6 4z" />
  </svg>
);

/** 口味：一片叶的脉络（你被什么吸引） */
export const IcTaste = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p} aria-hidden>
    <path d="M5 19C5 10 10 5 19 5c0 9-5 14-14 14z" />
    <path d="M5 19l9-9M9.5 14.5h3.2M12 12V9" />
  </svg>
);

export const IcGear = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p} aria-hidden>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M5.6 18.4l1.6-1.6M16.8 7.2l1.6-1.6" />
  </svg>
);

export const IcPlus = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p} aria-hidden>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IcClose = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} width={18} height={18} {...p} aria-hidden>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);
