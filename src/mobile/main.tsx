import { Buffer } from 'buffer'
import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core'
import { App as NativeApp } from '@capacitor/app'
import { bridge } from './bridge'

// services 里用到全局 Buffer（作业上传拼 multipart）
Object.assign(globalThis, { Buffer })
window.zju = bridge

// 渲染端在 window.zju 就位后再加载
const { useApp } = await import('../renderer/src/store')
await import('../renderer/src/main')

if (Capacitor.isNativePlatform()) {
  // 系统栏图标随应用的深浅色（不是系统的）
  const applyBars = (): void =>
    void SystemBars.setStyle({ style: document.documentElement.dataset['theme'] === 'dark' ? SystemBarsStyle.Dark : SystemBarsStyle.Light })
  applyBars()
  new MutationObserver(applyBars).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

  // 返回键：先收起全屏播放 / 课件大图 / 文件预览（它们都认 Esc），再关登录面板、作业侧页，然后按历史返回；到头了退到后台
  void NativeApp.addListener('backButton', () => {
    const state = useApp.getState()
    if (document.querySelector('.player[data-expanded], .lightbox, .preview')) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    } else if (state.loginOpen) {
      state.setLoginOpen(false)
    } else if (state.assignment || state.past.length) {
      state.back()
    } else {
      void NativeApp.minimizeApp()
    }
  })
}
