export type HostRole = "main-server" | "worker";
export type DeploymentTarget = "main-server" | "worker";
export type DeploymentPlatform = "synology" | "qnap" | "docker-nas" | "linux" | "windows";
export type DeploymentArchitecture = "x64" | "arm64";
export type DeploymentInstallMethod =
  | "docker-compose"
  | "portable-worker"
  | "powershell-worker"
  | "shell-worker";
export type PublicAccessMode =
  | "local-only"
  | "cloudflare-existing"
  | "tailscale-existing"
  | "custom-reverse-proxy";

/**
 * An immutable description of what the operator chose before installation.
 *
 * It is deliberately not a source of truth for the running server. Runtime
 * status belongs to the server/ExecutionHost records.
 */
export interface DeploymentPlan {
  readonly id: string;
  readonly target: DeploymentTarget;
  readonly platform: DeploymentPlatform;
  readonly architecture?: DeploymentArchitecture;
  readonly installMethod: DeploymentInstallMethod;
  readonly roles: readonly HostRole[];
  readonly dataPath?: string;
  readonly port?: number;
  readonly publicAccess: PublicAccessMode;
  readonly createdAt: string;
}

export interface DeploymentPlanDraft {
  readonly id?: string;
  readonly target: DeploymentTarget;
  readonly platform: DeploymentPlatform;
  readonly architecture?: DeploymentArchitecture;
  readonly installMethod?: DeploymentInstallMethod;
  readonly roles?: readonly HostRole[];
  readonly dataPath?: string;
  readonly port?: number;
  readonly publicAccess?: PublicAccessMode;
  readonly createdAt?: string;
}

export interface DeploymentPlanFactoryOptions {
  readonly createId?: () => string;
  readonly now?: () => Date;
}

export type SignedManifestTrust = {
  /** Immutable manifest asset used to verify this selected installation. */
  readonly url: string;
  readonly signatureUrl: string;
  /**
   * Mutable signed channel pointer used only for future update checks.
   * Legacy metadata may omit these and remain pinned to url/signatureUrl.
   */
  readonly channelUrl?: string;
  readonly channelSignatureUrl?: string;
  readonly sha256: string;
  readonly signatureAlgorithm: "rsa-sha256";
  /**
   * SHA-256 of the exact UTF-8 PEM text supplied in signingPublicKeyPem.
   * The caller must obtain this value and the PEM from a trusted release
   * configuration, not from the artifact download location.
   */
  readonly signingPublicKeySha256: string;
  readonly signingPublicKeyPem: string;
};

/**
 * No production default is bundled in the repository. The integration layer
 * must provide metadata rooted in the project's official release trust.
 */
export interface TrustedReleaseMetadata {
  readonly schemaVersion: 1;
  readonly version: string;
  readonly image: {
    readonly repository: string;
    readonly digest: string;
  };
  readonly manifest: SignedManifestTrust;
}

export interface TrustedWorkerPackageMetadata {
  readonly schemaVersion: 1;
  readonly version: string;
  readonly platform: "windows" | "linux";
  readonly architecture: DeploymentArchitecture;
  readonly format: "zip" | "tar.gz";
  readonly artifact: {
    readonly url: string;
    readonly sha256: string;
    readonly size: number;
    readonly minimumUpdaterProtocolVersion?: number;
    readonly fileName: string;
    /**
     * Relative path to the current-user CLI after extraction.
     */
    readonly entrypoint: string;
    /**
     * Windows portable UI launcher. Linux uses the CLI entrypoint directly.
     */
    readonly launcher?: string;
  };
  readonly manifest: SignedManifestTrust;
}

export interface DeploymentArtifact {
  readonly path: "compose.yaml" | ".env" | "install.sh" | "README-FIRST.txt";
  readonly mediaType: "application/yaml" | "text/plain" | "text/x-shellscript";
  readonly mode: 0o600 | 0o700;
  readonly sha256: string;
  readonly content: string;
}

/**
 * Serializable archive input. An HTTP route can stream these entries into a
 * ZIP/TAR implementation without this pure module knowing about Fastify.
 */
export interface DeploymentBundle {
  readonly kind: "claudex-deployment-bundle";
  readonly formatVersion: 1;
  readonly plan: DeploymentPlan;
  readonly release: {
    readonly version: string;
    readonly imageReference: string;
    readonly manifestSha256: string;
    readonly signingPublicKeySha256: string;
  };
  readonly artifacts: readonly DeploymentArtifact[];
}

export interface DeploymentBundleArchive {
  readonly fileName: string;
  readonly directoryName: string;
  readonly mediaType: "application/gzip";
  readonly encoding: "base64";
  readonly sha256: string;
  readonly size: number;
  readonly content: string;
}

export interface WorkerInstallCommand {
  readonly id:
    | "prepare"
    | "download"
    | "verify-release"
    | "extract"
    | "launch"
    | "pair"
    | "auto-start";
  readonly label: string;
  readonly shell: "powershell" | "sh";
  readonly command: string;
  readonly containsPairingCode: boolean;
}

export interface WorkerInstallInstructions {
  readonly kind: "claudex-worker-install-instructions";
  readonly formatVersion: 1;
  readonly plan: DeploymentPlan;
  readonly package: {
    readonly version: string;
    readonly url: string;
    readonly sha256: string;
    readonly size: number;
    readonly fileName: string;
    readonly signingPublicKeySha256: string;
  };
  readonly userScope: "current-user";
  readonly serviceType: "current-user-logon-task" | "systemd-user";
  readonly prerequisites: readonly string[];
  readonly commands: readonly WorkerInstallCommand[];
  readonly notes: readonly string[];
}

export class DeploymentValidationError extends Error {
  readonly field: string;

  constructor(field: string, message: string) {
    super(`${field}: ${message}`);
    this.name = "DeploymentValidationError";
    this.field = field;
  }
}
