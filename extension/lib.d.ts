export function encFrag(s: string): string;
export function fragmentUrl(pageUrl: string, sel: string): string;
export function cleanTitle(t: string): string;
export function isVideoPage(url: string): boolean;
export function fmtTime(sec: number): string;
export function timeUrl(pageUrl: string, sec: number): string;
export function captureUrl(o: { text?: string; url?: string; title?: string; why?: string; img?: string; tags?: string[]; clip?: boolean }): string;
export function menuToLink(
  id: string,
  info: { pageUrl?: string; selectionText?: string; srcUrl?: string; linkUrl?: string },
  tab: { url?: string; title?: string } | undefined,
  video?: { t: number; url: string; frame: boolean } | null,
): string;
