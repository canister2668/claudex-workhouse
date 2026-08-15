import type { InstallerBuildConfig } from "./types";

declare const __CLAUDEX_INSTALLER_CONFIG__: InstallerBuildConfig;

export const installerConfig: InstallerBuildConfig = Object.freeze(
  __CLAUDEX_INSTALLER_CONFIG__
);
