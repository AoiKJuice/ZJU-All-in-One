import { BrowserWindow, session, type Session } from 'electron'
import type { AuthState } from '@shared/types'

/**
 * ZJU 统一身份认证 (CAS at zjuam.zju.edu.cn).
 *
 * Strategy: the user logs in once inside a real BrowserWindow (handles captcha / 2FA / RSA-encrypted
 * password form for free). All cookies live in one persistent partition, so every service module can
 * reuse the CAS session via `zjuSession().fetch(...)` — hitting `cas/login?service=<svc>` with a valid
 * `iPlanetDirectoryPro` cookie silently issues a ticket for that service.
 */

export const CAS_BASE = 'https://zjuam.zju.edu.cn/cas'
const PARTITION = 'persist:zju'
/** Cookie set on .zju.edu.cn once CAS login succeeds. */
const CAS_COOKIE = 'iPlanetDirectoryPro'

export function zjuSession(): Session {
  return session.fromPartition(PARTITION)
}

export function casLoginUrl(service: string): string {
  return `${CAS_BASE}/login?service=${encodeURIComponent(service)}`
}

async function hasCasCookie(): Promise<boolean> {
  const cookies = await zjuSession().cookies.get({ name: CAS_COOKIE })
  return cookies.length > 0
}

export async function getAuthState(): Promise<AuthState> {
  if (!(await hasCasCookie())) return { loggedIn: false, user: null }
  // TODO: resolve real profile (e.g. from zdbk or CAS attributes); student id is not in the cookie.
  return { loggedIn: true, user: null }
}

/** Opens the CAS login page and resolves once the CAS cookie appears or the window is closed. */
export function login(parent?: BrowserWindow): Promise<AuthState> {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      parent,
      modal: !!parent,
      width: 480,
      height: 680,
      title: '浙江大学统一身份认证',
      autoHideMenuBar: true,
      webPreferences: { partition: PARTITION }
    })

    let settled = false
    const finish = async (): Promise<void> => {
      if (settled) return
      settled = true
      resolve(await getAuthState())
      if (!win.isDestroyed()) win.close()
    }

    const onCookie = (_e: unknown, cookie: Electron.Cookie, _cause: string, removed: boolean): void => {
      if (cookie.name === CAS_COOKIE && !removed) void finish()
    }
    zjuSession().cookies.on('changed', onCookie)
    win.on('closed', () => {
      zjuSession().cookies.off('changed', onCookie)
      void finish()
    })

    void win.loadURL(`${CAS_BASE}/login`)
  })
}

export async function logout(): Promise<AuthState> {
  await zjuSession().clearStorageData({ storages: ['cookies'] })
  return getAuthState()
}
