#!/usr/bin/env node
const { startWorkerUi } = await import("../dist-server/desktop-worker/ui.js");
await startWorkerUi(true);
