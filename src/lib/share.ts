import { parseQuick, type QuickDraft } from './quick';

export interface SharePayload {
  text?: string;
  subject?: string;
  image?: string; // data URL
}

/** Turn what another app shared into an item draft. Returns null if nothing usable. */
export function shareToDraft(p: SharePayload | null | undefined): QuickDraft | null {
  if (!p) return null;
  const text = (p.text || '').trim();
  const subject = (p.subject || '').trim();
  if (p.image) {
    return { type: 'image', title: (subject || text || '分享的图片').slice(0, 120), content: text && text !== subject ? text : '', creator: '', year: '', url: '', image: p.image, why: '', tags: ['分享'] };
  }
  if (!text && !subject) return null;
  const d = parseQuick(text || subject);
  if (!d) return null;
  if (d.url && subject && (d.title === d.url || !d.title)) d.title = subject.slice(0, 120);
  d.tags = Array.from(new Set([...d.tags, '分享'])).slice(0, 12);
  return d;
}

/** Read and clear whatever the Android share sheet handed us (bridge injected by the native side). */
export function takeShared(): SharePayload | null {
  const b = (window as unknown as { LinganShare?: { take: () => string } }).LinganShare;
  if (!b) return null;
  try {
    const s = b.take();
    return s ? (JSON.parse(s) as SharePayload) : null;
  } catch {
    return null;
  }
}
