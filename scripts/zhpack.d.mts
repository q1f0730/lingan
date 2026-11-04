export const FN: string;
export function packStrings(strings: string[]): string;
export function findStrings(code: string, min?: number): Array<{ start: number; end: number; value: string; tpl: boolean; raw?: string }>;
export interface Packed { code: string; strings: string[]; header: string; orig: string[]; ids: number[] }
export function packChunk(code: string, min?: number): Packed | null;
export function expandChunk(packed: Packed): string;
export function zhPack(): unknown;
