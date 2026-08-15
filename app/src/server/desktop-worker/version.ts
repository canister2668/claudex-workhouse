const configuredWorkerVersion = process.env.CLAUDEX_WORKHOUSE_WORKER_VERSION?.trim();

export const WORKER_VERSION = configuredWorkerVersion || "0.2.2";
