// 安卓端的 src/main/diagnostics.ts：只打到控制台（adb logcat 可见），不含账号

export function logDiagnostic(event: string, details: Record<string, unknown> = {}): void {
  console.info(`[diag] ${event}`, JSON.stringify(details))
}

export function initializeDiagnostics(): void {}
