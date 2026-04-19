import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";

/**
 * Dev-only middleware that proxies any `/api/<name>` request to the matching
 * `api/<name>.ts` Vercel function, so all our serverless endpoints work the
 * same way under `pnpm dev` as they do in production. The middleware is
 * stripped from the production bundle (`apply: "serve"`); Vercel picks up
 * the `api/*.ts` files directly when deployed.
 *
 * Files starting with `_` (like `_pushStore.ts`) are treated as internal
 * helpers and are NOT exposed as routes.
 */
function apiDevPlugin(): Plugin {
  return {
    name: "omnibridge-api-dev",
    apply: "serve",
    configureServer(server) {
      // Vite normally only exposes VITE_-prefixed vars to `import.meta.env`
      // and doesn't touch `process.env` at all. Our serverless functions
      // (api/*.ts) read from `process.env` (mirroring how they run on Vercel),
      // so we manually load every .env entry into process.env here. We use
      // `""` as the prefix filter to mean "all variables, not just VITE_*".
      const env = loadEnv(server.config.mode, server.config.root, "");
      for (const [key, value] of Object.entries(env)) {
        if (process.env[key] === undefined) process.env[key] = value;
      }
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? "";
        if (!url.startsWith("/api/")) return next();
        const route = url.slice("/api/".length).split("?")[0].replace(/\/$/, "");
        if (!route || route.startsWith("_") || route.includes("/")) return next();

        const filePath = path.resolve(__dirname, `api/${route}.ts`);
        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const raw = Buffer.concat(chunks).toString("utf8");

          const mod = (await server.ssrLoadModule(filePath)) as {
            default?: unknown;
          };
          if (typeof mod.default !== "function") {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: "no_default_export", route }));
            return;
          }
          const handler = mod.default as (...args: unknown[]) => unknown;

          // Dispatch based on handler arity:
          //   arity 1 → Edge / Fetch-style: `(req: Request) => Promise<Response>`
          //   arity 2 → Vercel Node classic: `(req: VercelRequest, res: VercelResponse)`
          // That's the same convention Vercel uses in production, so the files
          // don't need any special-casing per environment.
          if (handler.length >= 2) {
            // Build a minimal VercelRequest-ish / VercelResponse-ish shim on top
            // of the Node req/res Vite already gave us.
            const contentType = (req.headers["content-type"] ?? "").toString();
            let parsedBody: unknown = raw;
            if (raw && contentType.includes("application/json")) {
              try {
                parsedBody = JSON.parse(raw);
              } catch {
                parsedBody = raw;
              }
            }
            const vReq = Object.assign(req, {
              body: parsedBody,
              query: Object.fromEntries(new URL(url, "http://localhost").searchParams),
            });
            const vRes = Object.assign(res, {
              status(code: number) {
                res.statusCode = code;
                return vRes;
              },
              json(data: unknown) {
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify(data));
                return vRes;
              },
              send(data: unknown) {
                if (typeof data === "string") res.end(data);
                else res.end(JSON.stringify(data));
                return vRes;
              },
            });
            await (handler as (req: unknown, res: unknown) => unknown)(vReq, vRes);
            return;
          }

          // Fetch-style (edge)
          const fullUrl = new URL(url, "http://localhost");
          const headers: Record<string, string> = {};
          for (const [k, v] of Object.entries(req.headers)) {
            if (typeof v === "string") headers[k] = v;
            else if (Array.isArray(v)) headers[k] = v.join(", ");
          }
          const request = new Request(fullUrl, {
            method: req.method ?? "GET",
            headers,
            body:
              req.method && req.method !== "GET" && req.method !== "HEAD"
                ? raw || undefined
                : undefined,
          });
          const response = (await (handler as (r: Request) => Promise<Response>)(
            request,
          )) as Response;
          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          const text = await response.text();
          res.end(text);
        } catch (err) {
          // ENOENT means the file simply doesn't exist — let the next middleware (404) handle it.
          if ((err as NodeJS.ErrnoException).code === "ENOENT") return next();
          console.error(`[dev] /api/${route} failed:`, err);
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "server_error" }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [
    apiDevPlugin(),
    react(),
    VitePWA({
      // injectManifest lets us own the service worker source (src/sw.ts) so we
      // can add `push` and `notificationclick` handlers for Web Push, while
      // Workbox still injects the precache manifest at build time.
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "icons/*.svg", "icons/*.png"],
      manifest: {
        name: "OmniBridge — Multi-modal Community Help",
        short_name: "OmniBridge",
        description:
          "Local community help & resources for everyone — voice-first, translated, offline-ready.",
        theme_color: "#E06B2A",
        background_color: "#FFFBF5",
        display: "standalone",
        start_url: "/",
        scope: "/",
        lang: "sk",
        dir: "ltr",
        // Chromium browsers require at least one PNG icon >= 192x192 and one
        // >= 512x512 to consider the app installable (SVG alone is ignored).
        // We keep the SVGs at the end as scalable fallbacks.
        icons: [
          {
            src: "/icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icons/icon-maskable-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "maskable",
          },
          {
            src: "/icons/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
          {
            src: "/icons/icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any",
          },
          {
            src: "/icons/icon-maskable.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "maskable",
          },
        ],
      },
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
      },
      // injectManifest dev support — lets the SW load in `pnpm dev` so we can
      // test push without running a full build. Without this push only works
      // after `pnpm build && pnpm preview`.
      devOptions: {
        enabled: true,
        type: "module",
        navigateFallback: "index.html",
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
