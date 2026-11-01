import { BrowserWindow, net, session, type Session } from 'electron'

// PTA 的网络与窗口部分（独立分区 persist:pta）；安卓端由 src/mobile/ptaTransport.ts 以同样的接口替换

export const ptaSession = (): Session => session.fromPartition('persist:pta')

export interface PtaResponse<T> {
  status: number
  body: T
}

const CAPTCHA_APP_ID = '194593025'

export function request<T>(url: string, method = 'GET', body?: unknown): Promise<PtaResponse<T>> {
  return new Promise((resolve, reject) => {
    const req = net.request({ url, method, session: ptaSession(), useSessionCookies: true })
    req.setHeader('Accept', 'application/json;charset=UTF-8')
    if (body !== undefined) req.setHeader('Content-Type', 'application/json;charset=UTF-8')
    req.on('error', reject)
    req.on('response', (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('error', reject)
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve({ status: res.statusCode, body: (text ? JSON.parse(text) : {}) as T })
      })
    })
    if (body !== undefined) req.write(JSON.stringify(body))
    req.end()
  })
}

/**
 * 腾讯滑块验证码：在一个 pintia.cn 域下的小窗口里加载 TCaptcha.js 并弹出（验证码校验来源域名），
 * 用户完成后返回 ticket/randStr；关掉窗口或验证码返回 null
 */
export async function solveCaptcha(parent: BrowserWindow | undefined): Promise<{ ticket: string; randStr: string } | null> {
  const win = new BrowserWindow({
    parent,
    modal: !!parent,
    width: 400,
    height: 460,
    resizable: false,
    title: 'PTA 验证',
    autoHideMenuBar: true,
    backgroundColor: '#f3eee4',
    show: false,
    webPreferences: { session: ptaSession(), contextIsolation: true, sandbox: true }
  })
  try {
    // 任一 pintia.cn 页面即可，robots.txt 返回的是很小的 JSON
    await win.loadURL('https://pintia.cn/robots.txt')
    win.show()
    const closed = new Promise<null>((resolve) => win.on('closed', () => resolve(null)))
    const solved = win.webContents.executeJavaScript(`new Promise((resolve) => {
      document.body.innerHTML = ''
      document.body.style.background = '#f3eee4'
      const script = document.createElement('script')
      script.src = 'https://turing.captcha.qcloud.com/TCaptcha.js'
      script.onload = () => new window.TencentCaptcha('${CAPTCHA_APP_ID}', (r) => resolve(r)).show()
      script.onerror = () => resolve({ ret: -1 })
      document.head.appendChild(script)
    })`) as Promise<{ ret: number; ticket?: string; randstr?: string; errorCode?: number }>
    const result = await Promise.race([solved, closed])
    if (!result || result.ret !== 0 || result.errorCode || !result.ticket) return null
    return { ticket: result.ticket, randStr: result.randstr ?? '' }
  } finally {
    if (!win.isDestroyed()) win.close()
  }
}

/** PTA 网页登录（验证码等情况兜底），拿到 PTASession 即关窗 */
export async function webLogin(parent: BrowserWindow | undefined): Promise<void> {
  await new Promise<void>((resolve) => {
    const win = new BrowserWindow({
      parent,
      modal: !!parent,
      width: 480,
      height: 720,
      title: 'PTA 登录',
      autoHideMenuBar: true,
      webPreferences: { session: ptaSession(), contextIsolation: true, sandbox: true }
    })
    const cookies = ptaSession().cookies
    const onCookie = (_e: unknown, cookie: Electron.Cookie, _cause: string, removed: boolean): void => {
      if (cookie.name === 'PTASession' && !removed) win.close()
    }
    cookies.on('changed', onCookie)
    win.on('closed', () => {
      cookies.off('changed', onCookie)
      resolve()
    })
    void win.loadURL('https://pintia.cn/auth/login')
  })
}

export async function clearCookies(): Promise<void> {
  await ptaSession().clearStorageData({ storages: ['cookies'] })
}
