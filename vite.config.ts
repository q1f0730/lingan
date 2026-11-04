import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import { hashWasmPack } from './scripts/wasmpack.mjs';
import { zhPack } from './scripts/zhpack.mjs';
import { binPack } from './scripts/binpack.mjs';

const pkg = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  plugins: [react(), hashWasmPack(), binPack(), zhPack()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  clearScreen: false,
  server: { port: 5173, strictPort: true, host: process.env.TAURI_DEV_HOST || false },
  build: { target: ['es2021', 'chrome100', 'safari15'], chunkSizeWarningLimit: 1200, 
    // v0.23：首屏一个 app 块 = main.tsx 的全部静态依赖（含库层 db / Dexie）。点开才用的视图（搜索、待理、缺为什么、多选工具条…）
    // 各自单独成块。不这么写的话，打包器在视图改成懒加载后会把 db + Dexie 拆成单独的首屏块
    rolldownOptions: { output: { advancedChunks: { groups: [{ name: 'app', test: /src[\/]main\.tsx$/, includeDependenciesRecursively: true }] } } },
  },
  test: { environment: 'node' },
} as never);
