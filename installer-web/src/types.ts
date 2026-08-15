export type InstallerPlatform =
  | "windows-docker"
  | "synology"
  | "linux"
  | "windows-server"
  | "windows-worker";
export type AccessMode = "local-only" | "tailscale-existing" | "cloudflare-existing";

export interface ReleaseKey {
  readonly keyId: string;
  readonly algorithm: "rsa-sha256";
  readonly publicKeyPem: string;
  readonly notBefore: string;
  readonly expiresAt: string;
  readonly revoked: boolean;
}

export interface VerifiedReleaseKey extends ReleaseKey {
  readonly publicKeySha256: string;
  readonly modulusBase64: string;
  readonly exponentBase64: string;
}

export interface InstallerBuildConfig {
  readonly configured: boolean;
  readonly manifestUrl: string;
  readonly signatureUrl: string;
  readonly keyRing: readonly ReleaseKey[];
  readonly expectedChannel: string;
  readonly allowedImageRepositories: readonly string[];
  readonly allowedWorkerOrigins: readonly string[];
  readonly configurationError?: string;
}

export interface WorkerAsset {
  readonly platform: "windows" | "linux";
  readonly architecture: "x64" | "arm64";
  readonly format: "zip" | "tar.gz";
  readonly filename: string;
  readonly url: string;
  readonly size: number;
  readonly sha256: string;
  readonly minimumUpdaterProtocolVersion?:number;
  readonly entrypoint: string;
  readonly launcher?: string;
}
export interface WindowsPortableAsset {
  readonly platform:"windows";
  readonly architecture:"x64";
  readonly format:"zip";
  readonly filename:"claudex-workhouse-server-windows-x64-portable.zip";
  readonly url:string;
  readonly size:number;
  readonly sha256:string;
  readonly minimumUpdaterProtocolVersion:number;
}
export interface WindowsServerAsset {
  readonly platform:"windows";
  readonly architecture:"x64";
  readonly format:"exe";
  readonly filename:string;
  readonly url:string;
  readonly size:number;
  readonly sha256:string;
  readonly authenticode:
    | {readonly status:"unsigned"}
    | {
        readonly status:"valid";
        readonly certificateSha256:string;
        readonly subject:string;
        readonly timestamped:true;
      };
}

export interface ReleaseManifest {
  readonly schemaVersion: 1|2|3;
  readonly channel: string;
  readonly version: string;
  readonly releaseSequence: number;
  readonly publishedAt: string;
  readonly expiresAt: string;
  readonly server: {
    readonly image: string;
    readonly tag: string;
    readonly digest: string;
    readonly platforms: readonly ("linux/amd64" | "linux/arm64")[];
    readonly minimumUpdaterProtocolVersion?:number;
  };
  readonly windowsServer?:WindowsServerAsset;
  readonly windowsPortable?:WindowsPortableAsset;
  readonly workers: {
    readonly "windows-x64"?: WorkerAsset;
    readonly "linux-x64": WorkerAsset;
    readonly "linux-arm64": WorkerAsset;
  };
  readonly requirements: {
    readonly docker: string;
    readonly compose: string;
  };
  readonly legal?:{
    readonly license:"AGPL-3.0-only";
    readonly notice:"NOTICE.md";
    readonly thirdPartyNotices:"THIRD_PARTY_NOTICES.md";
  };
  readonly signing: {
    readonly keyId: string;
    readonly algorithm: "rsa-sha256";
  };
}

export interface VerifiedRelease {
  readonly manifest: ReleaseManifest;
  readonly manifestBytes: Uint8Array;
  readonly signatureBytes: Uint8Array;
  readonly manifestSha256: string;
  readonly verifiedKey: VerifiedReleaseKey;
  readonly verifiedAt: string;
  readonly manifestUrl: string;
  readonly signatureUrl: string;
  readonly immutableManifestUrl: string;
  readonly immutableSignatureUrl: string;
}

export interface InstallerPlan {
  readonly id: string;
  readonly platform: "synology" | "linux";
  readonly dataPath: string;
  readonly port: number;
  readonly accessMode: AccessMode;
  readonly serverOrigin: string;
}

export interface InstallerArtifact {
  readonly path: "compose.yaml" | ".env" | "install.sh" | "README-FIRST.txt";
  readonly mode: 0o600 | 0o700;
  readonly mediaType: "application/yaml" | "text/plain" | "text/x-shellscript";
  readonly content: string;
  readonly sha256: string;
}

export interface InstallerBundle {
  readonly directoryName: string;
  readonly archiveName: string;
  readonly plan: InstallerPlan;
  readonly release: VerifiedRelease;
  readonly artifacts: readonly InstallerArtifact[];
}
