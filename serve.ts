// Production server for the built app. The TanStack Start build emits a
// portable fetch handler (dist/server/server.js) plus static client assets
// (dist/client); this wraps them in a Bun server on PORT (default 3102).
// Run `bun run build` before starting.
//
// NOTE: Arvo deliberately binds to PORT (default 3102), never 3000 (WDA site),
// 3100 (IG app), or 3101 (FED).
import handler from "./dist/server/server.js";

const PORT = Number(process.env.PORT) || 3102;
const HOST = "0.0.0.0";
const CLIENT_DIR = `${import.meta.dir}/dist/client`;

Bun.serve({
  port: PORT,
  hostname: HOST,
  async fetch(req) {
    const { pathname } = new URL(req.url);
    if (pathname !== "/") {
      const file = Bun.file(CLIENT_DIR + pathname);
      if (await file.exists()) return new Response(file);
    }
    return (
      handler as { fetch: (r: Request) => Response | Promise<Response> }
    ).fetch(req);
  },
});

console.log(`Arvo serving on http://${HOST}:${String(PORT)}`);
