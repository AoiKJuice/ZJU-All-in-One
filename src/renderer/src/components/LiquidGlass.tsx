import { useEffect } from 'react'

// 液态玻璃只用在悬浮的导航与控件层（照 Apple 的用法：内容层不做玻璃）：标签栏、刊头导航与右侧按钮、翻周、轻提示、右键菜单
const TARGETS = '.tabbar, .mast-nav, .mast-meta, .week-float, .toast, .context-menu, .xk-switch, .news-switch'
const NS = 'http://www.w3.org/2000/svg'
// 透镜边缘宽度上限与最大位移（px）；色散：蓝、绿通道的位移比红通道略大
const BEZEL = 22
const SCALE = 34
const DISPERSION = [1, 1.05, 1.1]
// 高光的光源方向（左上）
const LIGHT = [-0.55, -0.83]

/**
 * 液态玻璃：照 kube.io「Liquid Glass in CSS and SVG」的思路，把元素当成边缘为凸圆弧（squircle）的玻璃板，
 * 按折射定律算出边缘一圈的位移（中间不动、越靠边越强），按元素实际尺寸与圆角画成位移图与高光图，
 * 组成 SVG 滤镜：轻微模糊 → 红绿蓝三通道各自位移（色散）→ 叠上沿边缘的高光，作为 backdrop-filter 使用（仅 Chromium，Electron 与安卓 WebView 都是）。
 * 元素上只写 --lg-filter，其余由 themes/glass.css 决定；离开液态玻璃风格时卸载并清掉
 */
export function LiquidGlass() {
  useEffect(() => {
    const svg = document.createElementNS(NS, 'svg')
    svg.setAttribute('aria-hidden', 'true')
    svg.style.cssText = 'position:fixed;width:0;height:0;pointer-events:none'
    const defs = document.createElementNS(NS, 'defs')
    svg.append(defs)
    document.body.append(svg)

    const made = new Set<string>()
    const applied = new Map<HTMLElement, string>()
    const sizes = new ResizeObserver(() => schedule())
    const dark = (): boolean => document.documentElement.dataset.theme === 'dark'

    const sync = (): void => {
      frame = 0
      for (const [el] of applied) if (!el.isConnected) applied.delete(el)
      // 尺寸种类太多时（拖动窗口等）整体重来，免得滤镜越积越多
      if (made.size > 32) {
        defs.replaceChildren()
        made.clear()
        applied.clear()
      }
      for (const el of document.querySelectorAll<HTMLElement>(TARGETS)) {
        const w = el.offsetWidth
        const h = el.offsetHeight
        if (!w || !h) continue
        const r = Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0, w / 2, h / 2)
        const key = `lg-${w}-${h}-${Math.round(r)}-${dark() ? 'd' : 'l'}`
        if (!made.has(key)) {
          defs.append(makeFilter(key, w, h, r, dark()))
          made.add(key)
        }
        if (applied.get(el) !== key) {
          if (!applied.has(el)) sizes.observe(el)
          el.style.setProperty('--lg-filter', `url(#${key})`)
          applied.set(el, key)
        }
      }
    }
    let frame = 0
    const schedule = (): void => {
      if (!frame) frame = requestAnimationFrame(sync)
    }
    const mutations = new MutationObserver(schedule)
    mutations.observe(document.body, { childList: true, subtree: true })
    // 深浅色切换时高光强度不同，要重算
    const theme = new MutationObserver(schedule)
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    schedule()

    return () => {
      cancelAnimationFrame(frame)
      mutations.disconnect()
      theme.disconnect()
      sizes.disconnect()
      for (const el of document.querySelectorAll<HTMLElement>(TARGETS)) el.style.removeProperty('--lg-filter')
      svg.remove()
    }
  }, [])
  return null
}

function node(tag: string, attrs: Record<string, string | number>): SVGElement {
  const el = document.createElementNS(NS, tag)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v))
  return el
}

function makeFilter(id: string, w: number, h: number, r: number, dark: boolean): SVGFilterElement {
  const { displacement, specular } = maps(w, h, r, dark)
  const box = { x: 0, y: 0, width: w, height: h }
  const filter = node('filter', { id, ...box, filterUnits: 'userSpaceOnUse', primitiveUnits: 'userSpaceOnUse', 'color-interpolation-filters': 'sRGB' }) as SVGFilterElement
  filter.append(
    node('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: 1.2, result: 'soft' }),
    node('feImage', { href: displacement, ...box, preserveAspectRatio: 'none', result: 'map' }),
    node('feImage', { href: specular, ...box, preserveAspectRatio: 'none', result: 'spec' })
  )
  // 三个通道各自位移再相加，边缘出现轻微的彩边
  const channels = ['1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0', '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0', '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0']
  channels.forEach((values, i) => {
    filter.append(
      node('feDisplacementMap', { in: 'soft', in2: 'map', scale: SCALE * DISPERSION[i], xChannelSelector: 'R', yChannelSelector: 'G', result: `d${i}` }),
      node('feColorMatrix', { in: `d${i}`, type: 'matrix', values, result: `c${i}` })
    )
  })
  filter.append(
    node('feComposite', { in: 'c0', in2: 'c1', operator: 'arithmetic', k2: 1, k3: 1, result: 'rg' }),
    node('feComposite', { in: 'rg', in2: 'c2', operator: 'arithmetic', k2: 1, k3: 1, result: 'lens' }),
    node('feComposite', { in: 'spec', in2: 'lens', operator: 'over' })
  )
  return filter
}

// 凸圆弧玻璃边缘的截面高度：x 为离边缘的距离占边缘宽度的比例（0 在最外沿，1 进入平坦区）
const height = (x: number): number => Math.pow(1 - Math.pow(1 - x, 4), 1 / 4)

// 沿截面取样一次：光线垂直射入，按斜率求法线、按折射率 1.5 求折射后的水平偏移，归一化到 0–1
const PROFILE = (() => {
  const n = 128
  const out = new Float32Array(n + 1)
  let max = 0
  for (let i = 0; i <= n; i++) {
    const x = Math.min(Math.max(i / n, 0.002), 0.998)
    const slope = (height(x + 0.001) - height(x - 0.001)) / 0.002
    const incidence = Math.atan(slope)
    const refracted = Math.asin(Math.sin(incidence) / 1.5)
    out[i] = Math.tan(incidence - refracted) * (1 - height(x) + 0.5)
    max = Math.max(max, out[i])
  }
  for (let i = 0; i <= n; i++) out[i] /= max
  return out
})()

/** 位移图（R/G 为水平/垂直位移，128 不动）与高光图（白色，透明度随法线朝向光源的程度） */
function maps(w: number, h: number, r: number, dark: boolean): { displacement: string; specular: string } {
  const bezel = Math.max(2, Math.min(BEZEL, r * 0.9 || BEZEL, h * 0.45, w * 0.45))
  const disp = new ImageData(w, h)
  const spec = new ImageData(w, h)
  const dd = disp.data
  const sd = spec.data
  const glow = dark ? 0.5 : 0.85
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5 - w / 2
      const py = y + 0.5 - h / 2
      // 到圆角矩形边缘的有向距离
      const qx = Math.abs(px) - (w / 2 - r)
      const qy = Math.abs(py) - (h / 2 - r)
      const ox = Math.max(qx, 0)
      const oy = Math.max(qy, 0)
      const out = Math.hypot(ox, oy)
      const depth = r - out - Math.min(Math.max(qx, qy), 0)
      const i = (y * w + x) * 4
      dd[i + 2] = 128
      dd[i + 3] = 255
      if (depth >= bezel) {
        dd[i] = 128
        dd[i + 1] = 128
        continue
      }
      let nx = 0
      let ny = 0
      if (out > 0) {
        nx = ox / out
        ny = oy / out
      } else if (qx > qy) nx = 1
      else ny = 1
      nx *= Math.sign(px)
      ny *= Math.sign(py)
      const t = Math.max(depth, 0) / bezel
      const m = PROFILE[Math.round(t * 128)]
      // 向内取样：边缘把背景往里折、放大
      dd[i] = 128 - nx * m * 127
      dd[i + 1] = 128 - ny * m * 127
      // 高光：贴着外沿的一道细亮边，朝光源一侧最亮，对侧较弱
      const facing = nx * LIGHT[0] + ny * LIGHT[1]
      const rim = Math.max(0, 1 - depth / 1.6)
      const sheen = Math.pow(1 - t, 3) * 0.35
      const a = (rim + sheen) * (facing > 0 ? facing : -facing * 0.45) * glow
      sd[i] = sd[i + 1] = sd[i + 2] = 255
      sd[i + 3] = Math.min(255, a * 255)
    }
  }
  return { displacement: toUrl(disp), specular: toUrl(spec) }
}

function toUrl(img: ImageData): string {
  const canvas = document.createElement('canvas')
  canvas.width = img.width
  canvas.height = img.height
  canvas.getContext('2d')!.putImageData(img, 0, 0)
  return canvas.toDataURL()
}
