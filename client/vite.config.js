import fs from 'fs';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

function readPortFromFile(repoRoot) {
  const file = path.join(repoRoot, '.aims-backend-port');
  try {
    const p = fs.readFileSync(file, 'utf8').trim();
    if (/^\d+$/.test(p)) return `http://127.0.0.1:${p}`;
  } catch {
    /* no file yet */
  }
  return null;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const repoRoot = path.resolve(__dirname, '..');
  const fromFile = readPortFromFile(repoRoot);
  const apiTarget = env.VITE_DEV_API_TARGET || fromFile || 'http://127.0.0.1:5000';

  const devSocketOrigin = mode === 'development' ? apiTarget : '';

  return {
    plugins: [react()],
    define: {
      __AIMS_DEV_API_ORIGIN__: JSON.stringify(devSocketOrigin),
    },
    server: {
      port: parseInt(env.VITE_DEV_PORT || '5173', 10),
      strictPort: false,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
          configure: (proxy) => {
            proxy.on('error', (err) => {
              // Avoid noisy ECONNREFUSED spam when API is not up yet
              if (err.code !== 'ECONNREFUSED') console.error('[vite proxy]', err.message);
            });
          },
        },
        '/socket.io': {
          target: apiTarget,
          ws: true,
          changeOrigin: true,
        },
      },
    },
  };
});
