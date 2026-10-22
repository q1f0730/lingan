import { describe, expect, it } from 'vitest';
import { isTauriEnv, QUICK_EVENT, QUICK_SHORTCUT } from '../lib/desktop';

describe('desktop', () => {
  it('detects tauri', () => {
    expect(isTauriEnv({})).toBe(false);
    expect(isTauriEnv({ __TAURI_INTERNALS__: {} })).toBe(true);
    expect(isTauriEnv(undefined)).toBe(false);
  });
  it('constants', () => {
    expect(QUICK_EVENT).toBe('quick-focus');
    expect(QUICK_SHORTCUT).toBe('Ctrl+Shift+L');
  });
});
