import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";

// Service worker removed on purpose (2026-07-12): the precaching SW caused
// three stale-shell incidents in one day (pinned CSP headers, deploy-gap blank
// screens, a wedged tablet). The shell is served with no-cache headers so it
// is always fresh without one; public/sw.js is a kill-switch that cleans up
// any client still running the old worker. PWA installability is kept via the
// static manifest link in index.html.
const buildStamp = () => ({
  name: "deck-build-stamp",
  transformIndexHtml(html: string) {
    return html.replace("</head>", `  <meta name="deck-build" content="${new Date().toISOString()}" />\n</head>`);
  }
});

export default defineConfig({
  plugins: [
    svelte(),
    buildStamp()
  ],
  // emptyOutDir off on purpose: clients holding the previous shell still fetch
  // the previous hashed assets during the deploy window; wiping them caused
  // transient blank screens. scripts/prune-dist.mjs removes stale hashes instead.
  build: { outDir: "dist", emptyOutDir: false, sourcemap: false, reportCompressedSize: false },
  test: {
    exclude: ["tests/e2e/**", "node_modules/**", "dist/**"],
    environmentOptions:{happyDOM:{settings:{disableCSSFileLoading:true,disableIframePageLoading:true,disableJavaScriptEvaluation:true}}},
  },
  server: { host: "127.0.0.1", port: 5173 }
});
