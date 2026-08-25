#!/usr/bin/env bash
# Produce a Vercel Build Output API bundle (.vercel/output) for this app, then
# deploy it with:  bunx vercel deploy --prebuilt --prod
#
# Why Build Output API instead of Vercel's Vite/framework detection:
#  - TanStack Start emits a host-agnostic fetch handler (dist/server/server.js)
#    that dynamic-imports its own ./assets chunks and externalizes node deps.
#    Bundling it into one self-contained function removes tracing/detection risk.
#    vercel-entry.ts adapts the Node (req,res) launcher to the web fetch handler.
set -euo pipefail
cd "$(dirname "$0")"
umask 002

echo "[1/3] vite build"
bun install
bun run build

echo "[2/3] assemble .vercel/output (Build Output API v3)"
rm -rf .vercel/output
mkdir -p .vercel/output/functions/render.func
cp -R dist/client .vercel/output/static
rm -f .vercel/output/static/index.html   # SSR owns "/", not a static shell

echo "[3/3] bundle SSR handler + deps into the render function"
# Split build (--outdir + --splitting) keeps TanStack's dynamically-imported
# server-fn chunks as real files; a single --outfile bundle inlines those
# dynamic imports and the server-fn registry loses its named exports at
# runtime ("Server function module export not resolved").
bun build vercel-entry.ts --target node \
  --outdir .vercel/output/functions/render.func --splitting
# bun names the entry after the input basename; rename to index.mjs to match
# .vc-config.json. Chunk references inside are relative and survive the rename.
mv .vercel/output/functions/render.func/vercel-entry.js \
  .vercel/output/functions/render.func/index.mjs
# Mark the .js chunks as ESM for the Node runtime (no package.json ships with
# the function dir, and .js defaults to CommonJS without this).
printf '{"type":"module"}\n' > .vercel/output/functions/render.func/package.json

cat > .vercel/output/functions/render.func/.vc-config.json <<'JSON'
{ "runtime": "nodejs22.x", "handler": "index.mjs", "launcherType": "Nodejs", "supportsResponseStreaming": true }
JSON
cat > .vercel/output/config.json <<'JSON'
{ "version": 3, "routes": [ { "handle": "filesystem" }, { "src": "/(.*)", "dest": "/render" } ] }
JSON

echo "done -> .vercel/output ready for: bunx vercel deploy --prebuilt --prod"
