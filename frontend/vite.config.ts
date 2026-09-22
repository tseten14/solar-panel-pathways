import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { Readable } from "node:stream";

/**
 * Serves the Vercel Functions in api/ from the dev server, so `npm run dev`
 * behaves like the deployed site. Registered before the /api proxy, so only
 * these routes bypass the Python backend.
 */
function vercelFunctions(): Plugin {
  const ROUTES = ["/api/solarcycle-ai/"];
  return {
      name: "vercel-functions",
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          const url = req.url ?? "";
          if (!ROUTES.some((r) => url.startsWith(r))) return next();
          try {
            const file = `${url.split("?")[0]}.ts`;
            const mod = await server.ssrLoadModule(file);
            const handler = mod[req.method ?? "GET"];
            if (typeof handler !== "function") {
              res.statusCode = 405;
              return res.end();
            }
            const controller = new AbortController();
            res.on("close", () => controller.abort());
            const request = new Request(`http://localhost${url}`, {
              method: req.method,
              headers: req.headers as Record<string, string>,
              body: req.method === "GET" || req.method === "HEAD" ? undefined : (Readable.toWeb(req) as ReadableStream),
            signal: controller.signal,
            // Node's fetch needs this to accept a streamed body.
            duplex: "half",
          } as RequestInit);
            const response: Response = await handler(request);
            res.statusCode = response.status;
            response.headers.forEach((value, key) => res.setHeader(key, value));
            if (!response.body) return res.end();
            Readable.fromWeb(response.body as import("node:stream/web").ReadableStream).pipe(res);
          } catch (err) {
            next(err);
          }
        });
      },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Server-only secrets for the functions above live in the repo-root .env.
  const rootEnv = loadEnv(mode, path.resolve(__dirname, ".."), "");
  for (const key of ["OPENAI_API_KEY", "OPENAI_MODEL", "SOLARCYCLE_AI_MODEL"]) {
    if (rootEnv[key] && !process.env[key]) process.env[key] = rootEnv[key];
  }
  return {
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
  plugins: [react(), vercelFunctions()],
  build: {
    rollupOptions: {
      output: {
        // Split the heavy, rarely-changing libraries into their own chunks.
        // Leaflet and Recharts together are most of the bundle, and the
        // Data Table page needs neither until you open a map or a chart page.
        manualChunks: {
          "vendor-react": ["react", "react-dom", "react-router-dom"],
          "vendor-map": ["leaflet", "react-leaflet"],
          "vendor-charts": ["recharts"],
        },
      },
    },
    chunkSizeWarningLimit: 700,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
  },
  };
});
