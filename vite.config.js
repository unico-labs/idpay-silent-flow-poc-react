import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    // In a real integration the transaction is created by the CLIENT's
    // backend (server-to-server). This dev proxy plays that role for the POC,
    // avoiding CORS on direct browser calls to the IDPay API.
    proxy: {
      '/idpay': {
        target: 'https://transactions.transactional.uat.unico.app',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/idpay/, ''),
      },
    },
  },
});
