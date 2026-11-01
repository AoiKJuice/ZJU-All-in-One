import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
// 思源宋体只打包 Medium 一档：比常规体略重，正文 400 也落到它
import '@fontsource/noto-serif-sc/500.css'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
