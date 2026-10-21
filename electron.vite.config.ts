import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const shared = { '@shared': resolve('src/shared') }

export default defineConfig({
  main: {
    resolve: { alias: shared }
  },
  preload: {
    resolve: { alias: shared },
    // Sandboxed preloads must be CommonJS; `.cjs` because package.json is `"type": "module"`.
    build: { rolldownOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } } }
  },
  renderer: {
    resolve: {
      alias: { ...shared, '@renderer': resolve('src/renderer/src') }
    },
    plugins: [react(), tailwindcss()],
    // 渲染端与主进程共用同一个 ZJU_DEMO 开关
    define: { 'import.meta.env.VITE_ZJU_DEMO': JSON.stringify(process.env['ZJU_DEMO'] ?? '') }
  }
})
