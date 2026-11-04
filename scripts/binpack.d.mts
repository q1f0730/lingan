export const PACK_RE: RegExp;
export function splitPack(code: string): { head: string; b64: string; index: number; len: number } | null;
export function binPack(): unknown;
