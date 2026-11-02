import { FORMS_CHANNELS, type FormsApi } from '@shared/forms'

// 问卷填写靠桌面端开窗注入脚本，手机端不提供（工具页按 MOBILE 隐藏入口）
const unsupported = (): Promise<never> => Promise.reject(new Error('手机端不支持'))

export const formsHandlers = Object.fromEntries(FORMS_CHANNELS.map((channel) => [channel, unsupported])) as unknown as FormsApi
