import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
// 思源宋体可变字重（200–900），按场景用不同字重区分层次
import '@fontsource-variable/noto-serif-sc'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
