import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'top.aoikjuice.zjuallinone',
  appName: 'ZJU All in One',
  webDir: 'out/mobile',
  server: {
    // 页面以 https://classroom.zju.edu.cn 为源（由应用本地提供，不访问该站）：
    // 智云回放与课件图校验 Referer，<video> / <img> 直接加载时据此通过，与桌面端补的 Referer 相同
    hostname: 'classroom.zju.edu.cn',
    androidScheme: 'https'
  },
  android: {
    backgroundColor: '#f3eee4'
  }
}

export default config
