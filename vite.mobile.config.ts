import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// 安卓端（Capacitor）：渲染端原样打包，主进程的 services 搬进 WebView 复用，
// 只把依赖 Electron / Node 的几个底层模块换成 src/mobile 下接口相同的实现

const main = resolve('src/main')
const mobile = resolve('src/mobile')

const REPLACE: Record<string, string> = {
  [resolve(main, 'http.ts')]: resolve(mobile, 'http.ts'),
  [resolve(main, 'secure.ts')]: resolve(mobile, 'secure.ts'),
  [resolve(main, 'diagnostics.ts')]: resolve(mobile, 'diagnostics.ts'),
  [resolve(main, 'auth/zjuam.ts')]: resolve(mobile, 'zjuam.ts'),
  [resolve(main, 'services/ptaTransport.ts')]: resolve(mobile, 'ptaTransport.ts'),
  'node:crypto': resolve(mobile, 'shims/crypto.ts'),
  'node:fs/promises': resolve(mobile, 'shims/fs.ts'),
  'node:path': resolve(mobile, 'shims/path.ts')
}

function replaceMainModules(): Plugin {
  return {
    name: 'zju-mobile-replace',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (REPLACE[source]) return REPLACE[source]
      if (!importer || !resolve(importer).startsWith(main) || !source.startsWith('.')) return null
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
      return resolved && REPLACE[resolve(resolved.id)] ? REPLACE[resolve(resolved.id)] : null
    }
  }
}

// `--mode demo`（或 ZJU_DEMO=1）：演示数据，便于在浏览器里调手机界面
export default defineConfig(({ mode }) => ({
  root: mobile,
  publicDir: resolve('src/renderer/public'),
  base: './',
  resolve: {
    alias: { '@shared': resolve('src/shared'), '@renderer': resolve('src/renderer/src') }
  },
  plugins: [replaceMainModules(), react(), tailwindcss()],
  define: {
    'import.meta.env.VITE_ZJU_DEMO': JSON.stringify(mode === 'demo' ? '1' : (process.env['ZJU_DEMO'] ?? '')),
    'process.env': '{}'
  },
  build: { outDir: resolve('out/mobile'), emptyOutDir: true }
}))
