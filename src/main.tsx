import React from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/heebo/index.css'
import './style.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
