import { defineConfig, devices } from "@playwright/test";

const e2eBaseUrl=process.env.CLAUDEX_WORKHOUSE_E2E_BASE_URL ?? "http://127.0.0.1:3410";
const managedServer=process.env.CLAUDEX_WORKHOUSE_E2E_MANAGED_SERVER==="1"||Boolean(process.env.CI);

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30000,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: e2eBaseUrl,
    extraHTTPHeaders: { "X-Claudex-Workhouse-Test-User": "admin@example.com" },
    reducedMotion: "reduce",
    trace: "retain-on-failure"
  },
  webServer:managedServer?{
    command:"node scripts/start-e2e-server.mjs",
    url:new URL("/api/health/live",e2eBaseUrl).href,
    reuseExistingServer:false,
    timeout:120000,
    env:{CLAUDEX_WORKHOUSE_E2E_BASE_URL:e2eBaseUrl}
  }:undefined,
  projects: [
    { name: "desktop-1280", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } } },
    { name: "mobile-360", use: { ...devices["Desktop Chrome"], viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true } },
    { name: "mobile-412", use: { ...devices["Desktop Chrome"], viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true } },
    { name: "tablet-800", use: { ...devices["Desktop Chrome"], viewport: { width: 800, height: 1280 }, isMobile: true, hasTouch: true } }
  ]
});
