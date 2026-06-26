import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// During local `vite dev`, proxy /api to the API server so cookies work on a
// single origin. In production the nginx container handles this proxy instead.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
