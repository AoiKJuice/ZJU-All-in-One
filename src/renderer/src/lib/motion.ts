// 动效速度（设置页）：所有 motion 动画时长经 dur() 乘上系数，CSS 过渡乘 --speed；关闭时为 0
let factor = 1

export const setMotionSpeed = (value: number): void => {
  factor = value
  document.documentElement.style.setProperty('--speed', String(value))
}

export const dur = (seconds: number): number => seconds * factor
