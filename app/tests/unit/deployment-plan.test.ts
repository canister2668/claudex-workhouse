import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DeploymentValidationError,
  createDeploymentBundleArchive,
  createDeploymentPlan,
  createWorkerInstallInstructions,
  generateMainServerBundle,
  renderWorkerInstallScript,
  verifyLocalWorkerPackage,
  type DeploymentArchitecture,
  type DeploymentPlatform,
  type TrustedReleaseMetadata,
  type TrustedWorkerPackageMetadata
} from "../../src/server/deployment/index.js";

/*
 * Synthetic test fixture only. There is intentionally no production release
 * key, image digest, artifact digest, or signature in source.
 */
const { publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const testPublicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
const testPublicKeySha256 = crypto
  .createHash("sha256")
  .update(testPublicKeyPem, "utf8")
  .digest("hex");

function releaseFixture(): TrustedReleaseMetadata {
  return {
    schemaVersion: 1,
    version: "1.3.0-test.1",
    image: {
      repository: "registry.example.test/claudex/workhouse",
      digest: `sha256:${"a".repeat(64)}`
    },
    manifest: {
      url: "https://releases.example.test/claudex/1.3.0-test.1/manifest.json",
      signatureUrl: "https://releases.example.test/claudex/1.3.0-test.1/manifest.sig",
      sha256: "b".repeat(64),
      signatureAlgorithm: "rsa-sha256",
      signingPublicKeySha256: testPublicKeySha256,
      signingPublicKeyPem: testPublicKeyPem
    }
  };
}

function workerPackageFixture(
  platform: "windows" | "linux",
  architecture: DeploymentArchitecture
): TrustedWorkerPackageMetadata {
  const windows = platform === "windows";
  return {
    schemaVersion: 1,
    version: "1.3.0-test.1",
    platform,
    architecture,
    format: windows ? "zip" : "tar.gz",
    artifact: {
      url: `https://releases.example.test/claudex/1.3.0-test.1/worker-${platform}-${architecture}.${windows ? "zip" : "tar.gz"}`,
      sha256: "c".repeat(64),
      size: 123_456,
      fileName: `worker-${platform}-${architecture}.${windows ? "zip" : "tar.gz"}`,
      entrypoint: windows
        ? "claudex-workhouse-worker-windows-x64/Worker CLI.cmd"
        : `claudex-workhouse-worker-linux-${architecture}/bin/claudex-workhouse-worker`,
      ...(windows
        ? {
            launcher:
              "claudex-workhouse-worker-windows-x64/Start Claudex Workhouse Worker.cmd"
          }
        : {})
    },
    manifest: releaseFixture().manifest
  };
}

const fixedFactory = {
  createId: () => "1d55e160-9b69-4b90-a93d-f38ca1b66206",
  now: () => new Date("2026-07-27T00:00:00.000Z")
};

describe("DeploymentPlan", () => {
  it.each<DeploymentPlatform>(["synology", "qnap", "docker-nas", "linux"])(
    "creates an immutable Docker Compose main-server plan for %s",
    (platform) => {
      const plan = createDeploymentPlan(
        {
          target: "main-server",
          platform,
          architecture: "arm64",
          dataPath: "/volume1/containers/claudex-workhouse",
          roles: ["worker", "main-server"],
          publicAccess: "cloudflare-existing"
        },
        fixedFactory
      );
      expect(plan).toEqual({
        id: "1d55e160-9b69-4b90-a93d-f38ca1b66206",
        target: "main-server",
        platform,
        architecture: "arm64",
        installMethod: "docker-compose",
        roles: ["main-server", "worker"],
        dataPath: "/volume1/containers/claudex-workhouse",
        port: 3410,
        publicAccess: "cloudflare-existing",
        createdAt: "2026-07-27T00:00:00.000Z"
      });
      expect(Object.isFrozen(plan)).toBe(true);
      expect(Object.isFrozen(plan.roles)).toBe(true);
      expect(() => ((plan as { port: number }).port = 80)).toThrow(TypeError);
      expect(() => (plan.roles as string[]).push("worker")).toThrow(TypeError);
    }
  );

  it.each([
    ["windows", "x64", "portable-worker"],
    ["windows", "x64", "powershell-worker"],
    ["linux", "x64", "portable-worker"],
    ["linux", "arm64", "shell-worker"]
  ] as const)("accepts the supported %s %s Worker flow (%s)", (platform, architecture, installMethod) => {
    const plan = createDeploymentPlan(
      {
        target: "worker",
        platform,
        architecture,
        installMethod,
        publicAccess: "custom-reverse-proxy"
      },
      fixedFactory
    );
    expect(plan.roles).toEqual(["worker"]);
    expect(plan.dataPath).toBeUndefined();
    expect(plan.port).toBeUndefined();
  });

  it("rejects unsupported targets, methods, architectures, and role escalation", () => {
    expect(() =>
      createDeploymentPlan(
        { target: "main-server", platform: "windows", dataPath: "/data/claudex" },
        fixedFactory
      )
    ).toThrow(/Windows main server is not supported/);
    expect(() =>
      createDeploymentPlan(
        {
          target: "main-server",
          platform: "linux",
          installMethod: "shell-worker",
          dataPath: "/data/claudex"
        },
        fixedFactory
      )
    ).toThrow(/require Docker Compose/);
    expect(() =>
      createDeploymentPlan(
        {
          target: "worker",
          platform: "synology",
          roles: ["worker"]
        },
        fixedFactory
      )
    ).toThrow(/only on Windows and Linux/);
    expect(() =>
      createDeploymentPlan(
        {
          target: "worker",
          platform: "windows",
          architecture: "arm64"
        },
        fixedFactory
      )
    ).toThrow(/supports x64 only/);
    expect(() =>
      createDeploymentPlan(
        {
          target: "worker",
          platform: "linux",
          roles: ["main-server", "worker"]
        },
        fixedFactory
      )
    ).toThrow(/only the worker role/);
    expect(() =>
      createDeploymentPlan(
        {
          target: "main-server",
          platform: "linux",
          roles: ["main-server", "main-server"],
          dataPath: "/data/claudex"
        },
        fixedFactory
      )
    ).toThrow(/duplicate roles/);
  });

  it.each([
    "/",
    "/data",
    "/data/../etc",
    "/etc/claudex/workhouse",
    "/tmp/claudex/workhouse",
    "/volume1/claudex;reboot/workhouse",
    "relative/claudex/workhouse"
  ])("rejects unsafe data path %s", (dataPath) => {
    expect(() =>
      createDeploymentPlan(
        { target: "main-server", platform: "linux", dataPath },
        fixedFactory
      )
    ).toThrow(DeploymentValidationError);
  });

  it("accepts normalized Unicode and internal spaces in a deployment path", () => {
    expect(
      createDeploymentPlan(
        {
          target: "main-server",
          platform: "synology",
          dataPath: "/volume1/공유 폴더/Claudex 작업장"
        },
        fixedFactory
      ).dataPath
    ).toBe("/volume1/공유 폴더/Claudex 작업장");
  });

  it.each([0, 80, 1023, 65536, 3410.5, Number.NaN])("rejects unsafe port %s", (port) => {
    expect(() =>
      createDeploymentPlan(
        {
          target: "main-server",
          platform: "linux",
          dataPath: "/srv/claudex/workhouse",
          port
        },
        fixedFactory
      )
    ).toThrow(/port/);
  });
});

describe("main-server deployment bundle", () => {
  const plan = createDeploymentPlan(
    {
      target: "main-server",
      platform: "synology",
      architecture: "x64",
      roles: ["main-server", "worker"],
      dataPath: "/volume1/containers/claudex-workhouse",
      port: 8787,
      publicAccess: "local-only"
    },
    fixedFactory
  );

  it("fails closed until independently trusted release metadata is configured", () => {
    expect(() =>
      generateMainServerBundle(plan, {
        serverOrigin: "http://192.168.1.20:8787"
      })
    ).toThrow(/trusted release metadata is not configured/);
  });

  it("rejects a signing-key fingerprint mismatch", () => {
    const release = releaseFixture();
    expect(() =>
      generateMainServerBundle(plan, {
        serverOrigin: "http://192.168.1.20:8787",
        release: {
          ...release,
          manifest: { ...release.manifest, signingPublicKeySha256: "d".repeat(64) }
        }
      })
    ).toThrow(/does not match the supplied public key/);
  });

  it("returns four digest-addressable in-memory artifacts with a pinned image and safe boundary", () => {
    const bundle = generateMainServerBundle(plan, {
      release: releaseFixture(),
      serverOrigin: "http://192.168.1.20:8787"
    });
    expect(bundle.kind).toBe("claudex-deployment-bundle");
    expect(Object.isFrozen(bundle)).toBe(true);
    expect(Object.isFrozen(bundle.artifacts)).toBe(true);
    expect(bundle.artifacts.map((entry) => entry.path)).toEqual([
      "compose.yaml",
      ".env",
      "install.sh",
      "README-FIRST.txt"
    ]);
    for (const entry of bundle.artifacts) {
      expect(entry.sha256).toBe(
        crypto.createHash("sha256").update(entry.content, "utf8").digest("hex")
      );
    }

    const compose = bundle.artifacts.find((entry) => entry.path === "compose.yaml")!.content;
    expect(compose).toContain(
      `image: "\${CLAUDEX_WORKHOUSE_IMAGE_REFERENCE:-registry.example.test/claudex/workhouse@sha256:${"a".repeat(64)}}"`
    );
    expect(compose).toContain('user: "10001:10001"');
    expect(compose).toContain("CLAUDEX_WORKHOUSE_OWNER_CLAIM: required");
    expect(compose).toContain("HOME: /opt/claudex-workhouse/runtime/home");
    expect(compose).toContain('CLAUDEX_WORKHOUSE_HOST_ROLES: "main-server,worker"');
    expect(compose).toContain("CLAUDEX_WORKHOUSE_INSTALL_METHOD: docker-compose");
    expect(compose).toContain("CLAUDEX_WORKHOUSE_DEPLOYMENT_PLATFORM: synology");
    expect(compose).toContain('CLAUDEX_WORKHOUSE_PUBLIC_ACCESS: "${CLAUDEX_WORKHOUSE_PUBLIC_ACCESS}"');
    expect(compose).toContain(
      'CLAUDEX_WORKHOUSE_BOOTSTRAP_ORIGIN: "${CLAUDEX_WORKHOUSE_EXTERNAL_ORIGIN}"'
    );
    expect(compose).toContain("cap_drop:");
    expect(compose).toContain("- ALL");
    expect(compose).toContain("no-new-privileges:true");
    expect(compose).toContain(
      "/snapshots:/opt/claudex-workhouse/snapshots"
    );
    expect(compose).not.toMatch(/image:.*(?:latest|:[0-9]+\.[0-9]+\.[0-9]+)\s*$/m);
    expect(compose).not.toContain("/var/run/docker.sock");
    expect(compose).not.toMatch(/^\s*privileged:/m);
    expect(compose).not.toMatch(/password|oauth|access_token|refresh_token/i);

    const env = bundle.artifacts.find((entry) => entry.path === ".env")!.content;
    expect(env).toContain("CLAUDEX_WORKHOUSE_DATA_PATH=/volume1/containers/claudex-workhouse");
    expect(env).toContain("CLAUDEX_WORKHOUSE_PORT=8787");
    expect(env).toContain("CLAUDEX_WORKHOUSE_PUBLIC_ACCESS=local-only");
    expect(env).not.toMatch(/password|oauth|access_token|refresh_token/i);

    const readme = bundle.artifacts.find((entry) => entry.path === "README-FIRST.txt")!.content;
    expect(readme).toContain("Docker Compose 2.20 or newer");
    expect(readme).toContain("owner-recovery-cli.js");
    expect(readme).toContain("revokes the previous owner credential");
  });

  it("packages every artifact into one extractable digest-addressed archive", () => {
    const bundle = generateMainServerBundle(plan, {
      release: releaseFixture(),
      serverOrigin: "http://192.168.1.20:8787"
    });
    const archive = createDeploymentBundleArchive(bundle);
    expect(archive).toMatchObject({
      mediaType: "application/gzip",
      encoding: "base64"
    });
    expect(archive.fileName).toBe(`claudex-workhouse-${plan.id}.tar.gz`);
    expect(archive.directoryName).toBe(`claudex-workhouse-${plan.id}`);
    const bytes = Buffer.from(archive.content, "base64");
    expect(archive.size).toBe(bytes.length);
    expect(archive.sha256).toBe(crypto.createHash("sha256").update(bytes).digest("hex"));

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "claudex-deployment-archive-"));
    const file = path.join(root, archive.fileName);
    try {
      fs.writeFileSync(file, bytes, { mode: 0o600 });
      const listed = spawnSync("tar", ["-tzf", file], { encoding: "utf8" });
      expect(listed.status, listed.stderr).toBe(0);
      expect(listed.stdout.trim().split("\n")).toEqual([
        `${archive.directoryName}/compose.yaml`,
        `${archive.directoryName}/.env`,
        `${archive.directoryName}/install.sh`,
        `${archive.directoryName}/README-FIRST.txt`
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("produces a syntactically valid, bounded, idempotent installer", () => {
    const bundle = generateMainServerBundle(plan, {
      release: releaseFixture(),
      serverOrigin: "http://192.168.1.20:8787"
    });
    const script = bundle.artifacts.find((entry) => entry.path === "install.sh")!.content;
    const syntax = spawnSync("sh", ["-n"], { input: script, encoding: "utf8" });
    expect(syntax.status, syntax.stderr).toBe(0);
    expect(script).toContain("docker compose version");
    expect(script).toContain("Docker Compose 2.20 or newer is required");
    expect(script).toContain('COMPOSE_VERSION=${COMPOSE_VERSION#v}');
    expect(script).toContain("COMPOSE_MAJOR");
    expect(script).toContain("sha256sum -c");
    expect(script).toContain("openssl dgst -sha256 -verify");
    expect(script).toContain("DETECTED_ARCHITECTURE=x64");
    expect(script).toContain("Deployment plan architecture %s does not match");
    expect(script).toContain("Deployment bundle is incomplete; missing %s");
    expect(script).toContain("docker compose --env-file .env -f compose.yaml pull");
    expect(script).toContain("docker compose --env-file .env -f compose.yaml up -d");
    expect(script).toContain("docker-host-updater.mjs");
    expect(script).toContain("release-key-ring.json");
    expect(script).toContain("apply-update.sh");
    expect(script).toContain("host_port_in_use");
    expect(script).toContain("port_belongs_to_current_compose");
    expect(script).toContain("Host port %s is already in use by another process");
    expect(script.indexOf("host_port_in_use")).toBeLessThan(
      script.indexOf("docker compose --env-file .env -f compose.yaml pull")
    );
    expect(script).toContain("choose another published port");
    expect(script).toContain("/api/health/ready");
    expect(script).toContain("/api/bootstrap/owner-claim/local");
    expect(script).not.toContain('"/api/bootstrap/owner-claim"');
    expect(script).toContain(
      "docker compose --env-file .env -f compose.yaml exec -T claudex-workhouse node -e"
    );
    expect(script).toContain("if(!response.ok)");
    expect(script).toContain("Owner claim URL (contains a ten-minute one-time secret; do not share)");
    expect(script).toContain("Expires at:");
    expect(script).toContain("Server fingerprint:");
    expect(script).not.toContain("process.stdout.write(await response.text())");
    expect(script).not.toMatch(/curl[^\n]*api\/bootstrap\/owner-claim\/local/);
    expect(script).toContain("chown 10001:10001");
    expect(script).not.toContain("chown -R");
    expect(script).toContain("Current identity is %s:%s");
    expect(script).toContain("refusing to overwrite");
    expect(script).not.toMatch(/\bsudo\b|\bapt(?:-get)?\b|\bsystemctl\b|docker compose down/);
    expect(script).not.toContain("/var/run/docker.sock");
    expect(script).not.toContain("rm -rf");
  });

  it("allows plain HTTP only for private local-only origins", () => {
    expect(() =>
      generateMainServerBundle(plan, {
        release: releaseFixture(),
        serverOrigin: "http://public.example.test:8787"
      })
    ).toThrow(/HTTP is allowed only/);
    expect(() =>
      generateMainServerBundle(
        { ...plan, publicAccess: "cloudflare-existing" },
        {
          release: releaseFixture(),
          serverOrigin: "http://192.168.1.20:8787"
        }
      )
    ).toThrow(/HTTP is allowed only/);
  });
});

describe("Worker installation instructions", () => {
  it("builds a current-user Windows portable flow with signed-manifest verification", () => {
    const plan = createDeploymentPlan(
      {
        target: "worker",
        platform: "windows",
        architecture: "x64",
        installMethod: "powershell-worker",
        publicAccess: "custom-reverse-proxy"
      },
      fixedFactory
    );
    const instructions = createWorkerInstallInstructions(plan, {
      workerPackage: workerPackageFixture("windows", "x64"),
      serverOrigin: "https://claudex.example.test",
      pairingCode: "ABCD-EFGH-JKLM"
    });
    expect(instructions.userScope).toBe("current-user");
    expect(instructions.serviceType).toBe("current-user-logon-task");
    expect(instructions.commands.every((command) => command.shell === "powershell")).toBe(true);
    expect(instructions.commands.find((command) => command.id === "verify-release")!.command).toContain(
      "RSASignaturePadding"
    );
    expect(instructions.commands.find((command) => command.id === "verify-release")!.command).not.toContain(
      "node -e"
    );
    expect(instructions.commands.find((command) => command.id === "prepare")!.command).toContain(
      "requires Windows x64"
    );
    expect(instructions.commands.find((command) => command.id === "verify-release")!.command).toContain(
      "1.3.0-test.1"
    );
    expect(instructions.commands.find((command) => command.id === "verify-release")!.command).toContain(
      "Worker package size mismatch"
    );
    expect(instructions.package.size).toBe(123_456);
    expect(instructions.commands.find((command) => command.id === "pair")!.command).toContain(
      "ABCD-EFGH-JKLM"
    );
    expect(instructions.commands.find((command) => command.id === "pair")!.command).toContain(
      "Worker pairing failed"
    );
    expect(instructions.commands.find((command) => command.id === "launch")!.command).toContain(
      "Start Claudex Workhouse Worker.cmd"
    );
    expect(instructions.commands.find((command) => command.id === "pair")!.command).toContain(
      "claudex-workhouse-worker-windows-x64\\Worker CLI.cmd"
    );
    expect(instructions.commands.find((command) => command.id === "extract")!.command).toContain(
      "Bundled Worker runtime is missing"
    );
    const joined = instructions.commands.map((command) => command.command).join("\n");
    const installScript = renderWorkerInstallScript(instructions);
    expect(joined).toContain("[Guid]::NewGuid");
    expect(joined).toContain(".claudex-workhouse-worker-staging-");
    expect(joined).toContain("AllowAutoRedirect = $false");
    expect(joined).toContain("ResponseHeadersRead");
    expect(joined).toContain("HTTPS redirect downgrade is not allowed");
    expect(joined).toContain("-MaximumBytes 123456 -ExpectedBytes 123456");
    expect(joined).toContain("-MaximumBytes 1048576");
    expect(joined).toContain("[System.IO.Compression.ZipFile]::OpenRead");
    expect(joined).toContain("ExternalAttributes");
    expect(joined).toContain("ReparsePoint");
    expect(joined).toContain("Worker ZIP entry escapes the staging directory");
    expect(joined).toContain("Move-Item -LiteralPath $workhouseStaging -Destination $workhouseTarget");
    expect(joined).toContain("Move-Item -LiteralPath $workhouseBackup -Destination $workhouseTarget");
    expect(joined).toContain("schtasks.exe /End");
    expect(joined).toContain(
      "Join-Path $workhouseTarget 'claudex-workhouse-worker-windows-x64\\node.exe'"
    );
    expect(joined).toContain("Bundled Worker application is missing");
    expect(joined).not.toContain(
      "Expand-Archive -LiteralPath $workhouseArchive -DestinationPath $workhouseTarget -Force"
    );
    expect(installScript).toContain("} finally {");
    expect(installScript).toContain(
      "Remove-Item -LiteralPath $workhouseCleanupPath -Recurse -Force"
    );
    expect(instructions.prerequisites.join("\n")).not.toContain("Node.js");
    expect(
      instructions.commands.filter((command) => command.command.includes("ABCD-EFGH-JKLM"))
    ).toHaveLength(1);
    expect(instructions.commands.map((command) => command.command).join("\n")).not.toMatch(
      /\bsudo\b|\/RU\s+SYSTEM|\/RL\s+HIGHEST/i
    );
    expect(installScript).toMatch(
      /^\$ErrorActionPreference = 'Stop'\nSet-StrictMode -Version Latest/
    );
  });

  it.each<DeploymentArchitecture>(["x64", "arm64"])(
    "builds a rootless Linux %s portable/systemd-user flow",
    (architecture) => {
      const plan = createDeploymentPlan(
        {
          target: "worker",
          platform: "linux",
          architecture,
          installMethod: "shell-worker",
          publicAccess: "cloudflare-existing"
        },
        fixedFactory
      );
      const instructions = createWorkerInstallInstructions(plan, {
        workerPackage: workerPackageFixture("linux", architecture),
        serverOrigin: "https://claudex.example.test",
        pairingCode: "2345-6789-ABCD"
      });
      expect(instructions.serviceType).toBe("systemd-user");
      expect(instructions.commands.every((command) => command.shell === "sh")).toBe(true);
      const joined = instructions.commands.map((command) => command.command).join("\n");
      const installScript = renderWorkerInstallScript(instructions);
      expect(joined).toContain("openssl dgst -sha256 -verify");
      expect(joined).toContain("WORKHOUSE_ARCHITECTURE");
      expect(joined).toContain("mktemp -d");
      expect(joined).not.toContain('WORKHOUSE_TEMP="${TMPDIR:-/tmp}/claudex-workhouse-worker-install"');
      expect(joined).toContain(".claudex-workhouse-worker-staging.XXXXXX");
      expect(joined).toContain("--max-redirs 5");
      expect(joined).toContain("--proto '=https' --proto-redir '=https'");
      expect(joined).toContain('--max-filesize "$WORKHOUSE_DOWNLOAD_MAXIMUM"');
      expect(joined).toContain('head -c "$((WORKHOUSE_DOWNLOAD_MAXIMUM + 1))"');
      expect(joined).toMatch(/workhouse_download_bounded [^\n]+ "\$WORKHOUSE_ARCHIVE" 123456/);
      expect(joined).toContain("Worker release response exceeds its allowed size");
      expect(joined).toContain("Worker release manifest exceeds its allowed size");
      expect(joined).toContain("Worker package size mismatch");
      expect(joined).toContain("tar -tvzf");
      expect(joined).toContain("symbolic link, hard link, or special file");
      expect(joined).toContain("--no-same-owner --no-same-permissions");
      expect(joined).toContain("Bundled Worker runtime is missing");
      expect(joined).toContain("Bundled Worker application is missing");
      expect(joined).toContain('mv -- "$WORKHOUSE_STAGING" "$WORKHOUSE_TARGET"');
      expect(joined).toContain('mv -- "$WORKHOUSE_BACKUP" "$WORKHOUSE_TARGET"');
      expect(joined).not.toContain(
        'tar -xzf "$WORKHOUSE_ARCHIVE" -C "$WORKHOUSE_TARGET"'
      );
      expect(joined).toContain("1.3.0-test.1");
      expect(joined).toContain("install-service");
      expect(joined).toContain(
        `claudex-workhouse-worker-linux-${architecture}/bin/claudex-workhouse-worker`
      );
      expect(joined).not.toMatch(/\bsudo\b|systemctl\s+(?!.*--user)/);
      expect(instructions.prerequisites.join("\n")).not.toContain("Node.js 20");
      const syntax = spawnSync("sh", ["-n"], { input: joined, encoding: "utf8" });
      expect(syntax.status, syntax.stderr).toBe(0);
      expect(installScript).toMatch(/^set -eu\n/);
      expect(installScript).toContain("trap workhouse_cleanup EXIT");
      expect(installScript).toContain('rm -rf -- "$WORKHOUSE_STAGING"');
      expect(installScript).toContain('rm -rf -- "$WORKHOUSE_TEMP"');
      const installSyntax = spawnSync("sh", ["-n"], { input: installScript, encoding: "utf8" });
      expect(installSyntax.status, installSyntax.stderr).toBe(0);
    }
  );

  it("rejects absent, mismatched, or fake package trust inputs", () => {
    const plan = createDeploymentPlan(
      {
        target: "worker",
        platform: "linux",
        architecture: "arm64"
      },
      fixedFactory
    );
    expect(() =>
      createWorkerInstallInstructions(plan, {
        serverOrigin: "https://claudex.example.test",
        pairingCode: "2345-6789-ABCD"
      })
    ).toThrow(/trusted Worker package metadata is not configured/);
    expect(() =>
      createWorkerInstallInstructions(plan, {
        workerPackage: workerPackageFixture("linux", "x64"),
        serverOrigin: "https://claudex.example.test",
        pairingCode: "2345-6789-ABCD"
      })
    ).toThrow(/must match the deployment plan/);
    expect(() =>
      createWorkerInstallInstructions(plan, {
        workerPackage: workerPackageFixture("linux", "arm64"),
        serverOrigin: "https://claudex.example.test",
        pairingCode: "not-a-code"
      })
    ).toThrow(/one-time Worker pairing code/);
  });
});

describe("verified local Worker package", () => {
  it("returns bytes only when file name, size, and SHA-256 match trusted metadata", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "claudex-worker-package-"));
    const content = Buffer.from("verified worker package\n", "utf8");
    const metadata = workerPackageFixture("windows", "x64");
    const trusted = {
      ...metadata,
      artifact: {
        ...metadata.artifact,
        fileName: "worker-windows-x64.zip",
        url: "https://releases.example.test/worker-windows-x64.zip",
        size: content.length,
        sha256: crypto.createHash("sha256").update(content).digest("hex")
      }
    };
    try {
      fs.writeFileSync(path.join(root, trusted.artifact.fileName), content);
      const result = await verifyLocalWorkerPackage(root, trusted);
      expect(result).toMatchObject({
        fileName: trusted.artifact.fileName,
        size: content.length,
        sha256: trusted.artifact.sha256
      });
      expect(result.content).toEqual(content);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails closed for a missing, wrong-sized, or modified local package", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "claudex-worker-package-invalid-"));
    const content = Buffer.from("trusted bytes", "utf8");
    const metadata = workerPackageFixture("windows", "x64");
    const trusted = {
      ...metadata,
      artifact: {
        ...metadata.artifact,
        fileName: "worker-windows-x64.zip",
        url: "https://releases.example.test/worker-windows-x64.zip",
        size: content.length,
        sha256: crypto.createHash("sha256").update(content).digest("hex")
      }
    };
    const file = path.join(root, trusted.artifact.fileName);
    try {
      await expect(verifyLocalWorkerPackage(root, trusted)).rejects.toThrow(/unavailable/);
      fs.writeFileSync(file, Buffer.concat([content, Buffer.from("!")]));
      await expect(verifyLocalWorkerPackage(root, trusted)).rejects.toThrow(/size/);
      fs.writeFileSync(file, Buffer.from("altered bytes", "utf8"));
      const sameSize = {
        ...trusted,
        artifact: { ...trusted.artifact, size: fs.statSync(file).size }
      };
      await expect(verifyLocalWorkerPackage(root, sameSize)).rejects.toThrow(/digest/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
