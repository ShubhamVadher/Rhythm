import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 8888,
    // Bind to 0.0.0.0 so the server is reachable on both
    // localhost AND 127.0.0.1 (Spotify's redirect URI uses 127.0.0.1)
    host: '0.0.0.0',
    proxy: {
      // Forward all /auth/* API calls to Express
      '/auth': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        secure: false,
        // Do NOT let Vite follow the 302 redirect internally —
        // pass it straight to the browser so it can navigate to Spotify
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            // keep the Location header intact for redirects
            if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400) {
              proxyRes.headers['location'] = proxyRes.headers['location'];
            }
          });
        },
      },
      '/user': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        secure: false,
      },
      '/me': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        secure: false,
      },
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        secure: false,
      },
    }
  }
})
