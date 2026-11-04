export function packHashWasm(code: string): { code: string; packed: number };
export function hashWasmPack(): { name: string; apply: 'build'; transform(code: string, id: string): { code: string; map: null } | null };
