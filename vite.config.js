import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Optional local-dev overrides, read from .env.local (see .env.local.example):
//
// - VITE_API_TARGET: overrides the /idpay proxy target. Defaults to UAT.
//   Set to http://localhost:8888 to test against a local mirrord session
//   instead of the real deployment — requires a `kubectl port-forward` to
//   the transactions-api pod on that port (see idpay/deployments/mirrord
//   docs in the monorepo).
// - VITE_MIRRORD_USER: when set, injects the x-mirrord-user header on every
//   /idpay request, so mirrord (steal mode) intercepts the traffic into
//   your local build instead of letting it hit the real pod. Must match
//   the header_filter configured in your mirrord.json.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = env.VITE_API_TARGET || 'https://transactions.transactional.uat.unico.app';
  const mirrordUser = env.VITE_MIRRORD_USER;

  return {
    plugins: [react()],
    server: {
      port: 3000,
      // In a real integration the transaction is created by the CLIENT's
      // backend (server-to-server). This dev proxy plays that role for the POC,
      // avoiding CORS on direct browser calls to the IDPay API.
      proxy: {
        '/idpay': {
          target: apiTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/idpay/, ''),
          ...(mirrordUser && {
            configure: (proxy) => {
              proxy.on('proxyReq', (proxyReq) => {
                proxyReq.setHeader('x-mirrord-user', mirrordUser);
              });
            },
          }),
        },
      },
    },
  };
});
