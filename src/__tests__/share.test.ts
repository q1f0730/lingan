import { describe, expect, it } from 'vitest';
import { shareToDraft } from '../lib/share';

describe('shareToDraft', () => {
  it('link with subject uses subject as title', () => {
    const d = shareToDraft({ text: 'https://example.com/a', subject: '好文章' })!;
    expect(d.url).toBe('https://example.com/a');
    expect(d.title).toBe('好文章');
    expect(d.tags).toContain('分享');
  });
  it('plain text becomes idea', () => {
    expect(shareToDraft({ text: '一个念头' })!.type).toBe('idea');
  });
  it('image', () => {
    const d = shareToDraft({ image: 'data:image/png;base64,AA' })!;
    expect(d.type).toBe('image');
    expect(d.image).toBeTruthy();
  });
  it('empty → null', () => {
    expect(shareToDraft({ text: '  ' })).toBeNull();
    expect(shareToDraft(null)).toBeNull();
  });
});
