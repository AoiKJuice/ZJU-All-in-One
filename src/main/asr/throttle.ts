import { spawn } from 'node:child_process'

// 显卡占用上限：按占空比轮流挂起 / 恢复 Whisper 进程。挂起期间它不再提交 CUDA 任务，
// 显卡空出来给 Chromium 的 GPU 进程画界面，平均占用约为 duty。
// 挂起靠 ntdll 的 NtSuspendProcess，由一个常驻 PowerShell 执行：stdin 收 s / r；
// stdin 关闭（本进程退出或调用 stop）时先恢复再退出，Whisper 不会被永久挂起。
const HELPER = `
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class Nt {
  [DllImport("ntdll.dll")] public static extern int NtSuspendProcess(IntPtr h);
  [DllImport("ntdll.dll")] public static extern int NtResumeProcess(IntPtr h);
}
'@
$h = (Get-Process -Id $env:THROTTLE_PID).Handle
$suspended = $false
while ($null -ne ($line = [Console]::In.ReadLine())) {
  if ($line -eq 's' -and -not $suspended) { [void][Nt]::NtSuspendProcess($h); $suspended = $true }
  elseif ($line -eq 'r' -and $suspended) { [void][Nt]::NtResumeProcess($h); $suspended = $false }
}
if ($suspended) { [void][Nt]::NtResumeProcess($h) }
`

const PERIOD = 200

/** 把 pid 的平均运行时间限制在 duty（0–1）；返回停止函数 */
export function throttle(pid: number, duty: number): () => void {
  if (process.platform !== 'win32' || duty >= 1) return () => {}

  const helper = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', HELPER], {
    windowsHide: true,
    stdio: ['pipe', 'ignore', 'ignore'],
    env: { ...process.env, THROTTLE_PID: String(pid) }
  })
  helper.on('error', () => {})
  helper.stdin.on('error', () => {})

  const on = Math.round(PERIOD * duty)
  let timer: ReturnType<typeof setTimeout> | undefined
  const cycle = (): void => {
    helper.stdin.write('s\n')
    timer = setTimeout(() => {
      helper.stdin.write('r\n')
      timer = setTimeout(cycle, on)
    }, PERIOD - on)
  }
  timer = setTimeout(cycle, on)

  return () => {
    clearTimeout(timer)
    helper.stdin.end('r\n')
  }
}
