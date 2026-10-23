import { BrowserWindow, session, type Cookie, type Session } from 'electron'

export const CAS_BASE = 'https://zjuam.zju.edu.cn/cas'
const PARTITION = 'persist:zju'
const CAS_COOKIE = 'iPlanetDirectoryPro'

export function zjuSession(): Session {
  return session.fromPartition(PARTITION)
}

export function casLoginUrl(service: string): string {
  return `${CAS_BASE}/login?service=${encodeURIComponent(service)}`
}

export async function hasCasCookie(): Promise<boolean> {
  const cookies = await zjuSession().cookies.get({
    url: `${CAS_BASE}/login`,
    name: CAS_COOKIE
  })

  return cookies.length > 0
}

// 总是打开登录窗口：cookie 可能已在服务器端过期；若 CAS 仍有效，登录页会立即跳转写回 cookie 并自动关窗
export async function login(parent?: BrowserWindow): Promise<void> {
  return new Promise((resolve, reject) => {
    const authSession = zjuSession()
    const win = new BrowserWindow({
      parent,
      modal: !!parent,
      width: 480,
      height: 680,
      title: '浙江大学统一身份认证',
      autoHideMenuBar: true,
      webPreferences: {
        session: authSession,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true
      }
    })

    let settled = false

    function finish(error?: Error): void {
      if (settled) return
      settled = true
      authSession.cookies.off('changed', onCookie)

      if (error) reject(error)
      else resolve()

      if (!win.isDestroyed()) win.close()
    }

    function onCookie(
      _event: unknown,
      cookie: Cookie,
      _cause: string,
      removed: boolean
    ): void {
      const domain = cookie.domain?.replace(/^\./, '')
      if (
        cookie.name === CAS_COOKIE &&
        !removed &&
        (domain === 'zjuam.zju.edu.cn' || domain === 'zju.edu.cn')
      ) {
        finish()
      }
    }

    authSession.cookies.on('changed', onCookie)
    win.on('closed', () => finish())

    void win.loadURL(`${CAS_BASE}/login`).catch(() => {
      finish(new Error('认证页面加载失败'))
    })
  })
}

export async function logout(): Promise<void> {
  await zjuSession().clearStorageData({ storages: ['cookies'] })
}
