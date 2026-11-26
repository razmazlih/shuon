import React from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/heebo/index.css'
import './style.css'
import App from './App'

const root = document.documentElement

window.addEventListener('pointerdown', () => {
  root.setAttribute('data-pointer-focus', '')
}, { capture: true, passive: true })

window.addEventListener('keydown', (event) => {
  const navigatesWithArrow = event.key.startsWith('Arrow')
    && event.target instanceof Element
    && !event.target.closest('input, textarea, [contenteditable]')

  if (event.key === 'Tab' || navigatesWithArrow) {
    root.removeAttribute('data-pointer-focus')
  }
}, { capture: true })

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
