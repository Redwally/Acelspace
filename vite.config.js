import { defineConfig, loadEnv } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    const allowedHost = env.ALLOWED_HOST || process.env.ALLOWED_HOST;
    const allowedHosts = allowedHost
        ? allowedHost.split(',').map(h => h.trim()).filter(Boolean)
        : [];

    return {
        plugins: [
            tailwindcss(),
        ],
        server: {
            port: 5173,
            allowedHosts,
            proxy: {
                '/api': {
                    target: 'http://localhost:3000',
                    changeOrigin: true,
                },
                '/uploads': {
                    target: 'http://localhost:3000',
                    changeOrigin: true,
                }
            }
        },
        preview: {
            allowedHosts,
        },
        build: {
            rollupOptions: {
                input: {
                    main: resolve(__dirname, 'index.html'),
                    admin: resolve(__dirname, 'admin.html'),
                    print: resolve(__dirname, 'admin-print.html'),
                    legal: resolve(__dirname, 'mentions-legales.html'),
                    privacy: resolve(__dirname, 'politique-confidentialite.html'),
                }
            }
        }
    };
});
