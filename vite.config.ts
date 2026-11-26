import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/@firebase/firestore/') || id.includes('/firebase/firestore/')) return 'firestore'
          if (id.includes('/@firebase/auth/') || id.includes('/firebase/auth/')) return 'auth'
          if (id.includes('/@firebase/') || id.includes('/firebase/')) return 'firebase'
          if (id.includes('/react-dom/') || id.includes('/react/') || id.includes('/scheduler/'))
            return 'react'
        },
      },
    },
  },
})
