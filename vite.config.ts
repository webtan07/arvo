import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";

// NOTE: Arvo = car-detailing booking app. It binds to its own port (default
// 3102) — never 3000 (WDA site), 3100 (IG app), or 3101 (FED).
const PORT = Number(process.env.PORT) || 3102;

export default defineConfig({
  server: {
    port: PORT,
    host: true,
    // Accept any Host header so the app works behind a proxy / tunnel.
    allowedHosts: true,
  },
  plugins: [
    tailwindcss(),
    tsConfigPaths({
      projects: ["./tsconfig.json"],
    }),
    tanstackStart({
      router: {
        // src/routes/api/health.ts is a server-function module (not a route);
        // keep the router generator from warning about it missing a Route export.
        // routeFileIgnorePattern is a REGEX (matched per directory entry), not a glob.
        routeFileIgnorePattern: "^api$",
      },
    }),
    viteReact(),
  ],
});
