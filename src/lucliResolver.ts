import * as vscode from "vscode";
import * as https from "https";
import * as fs from "fs";
import * as path from "path";
import { execFile } from "child_process";

const GITHUB_RELEASES_API =
  "https://api.github.com/repos/cybersonic/LuCLI/releases/latest";

let storageBinDir: string | undefined;
let downloadedJarPath: string | undefined;

/**
 * Initialise the resolver. Call once from `activate()`.
 * Scans globalStorageUri for a previously-downloaded JAR.
 */
export function initResolver(context: vscode.ExtensionContext): void {
  storageBinDir = path.join(context.globalStorageUri.fsPath, "bin");

  if (fs.existsSync(storageBinDir)) {
    const jars = fs
      .readdirSync(storageBinDir)
      .filter((f) => f.endsWith(".jar"))
      .sort(); // lexicographic — newest version name wins
    if (jars.length > 0) {
      downloadedJarPath = path.join(storageBinDir, jars[jars.length - 1]);
    }
  }
}

/**
 * Returns the effective lucli path to use:
 *   1. User-configured `lucli.path` setting (highest priority)
 *   2. Previously downloaded JAR in extension storage
 *   3. Empty string (fall back to `lucli` on PATH)
 */
export function getEffectiveLucliPath(): string {
  const configured = vscode.workspace
    .getConfiguration()
    .get<string>("lucli.path") || "";
  if (configured) {
    return configured;
  }
  return downloadedJarPath || "";
}

// ── Java check ─────────────────────────────────────────────────────

export function checkJavaAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile("java", ["-version"], (_error, _stdout, stderr) => {
      if (_error) {
        resolve(false);
        return;
      }
      // `java -version` writes to stderr
      const output = stderr || _stdout || "";
      const match = output.match(/version "(\d+)/);
      if (match) {
        resolve(parseInt(match[1], 10) >= 17);
      } else {
        resolve(false);
      }
    });
  });
}

// ── GitHub release helpers ─────────────────────────────────────────

interface GitHubRelease {
  tag_name: string;
  assets: Array<{ name: string; browser_download_url: string }>;
}

interface ReleaseInfo {
  tag: string;
  version: string;
  jarUrl: string;
}

function httpsGetJson(url: string): Promise<GitHubRelease> {
  return new Promise((resolve, reject) => {
    const get = (requestUrl: string, redirects = 0) => {
      if (redirects > 5) {
        reject(new Error("Too many redirects"));
        return;
      }

      https
        .get(
          requestUrl,
          { headers: { Accept: "application/vnd.github+json", "User-Agent": "vscode-lucli" } },
          (res) => {
            if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
              get(res.headers.location, redirects + 1);
              return;
            }
            if (res.statusCode !== 200) {
              reject(new Error(`GitHub API returned ${res.statusCode}`));
              return;
            }
            let data = "";
            res.on("data", (chunk: Buffer) => { data += chunk.toString(); });
            res.on("end", () => {
              try { resolve(JSON.parse(data)); }
              catch (e) { reject(e); }
            });
          }
        )
        .on("error", reject);
    };
    get(url);
  });
}

async function fetchLatestRelease(): Promise<ReleaseInfo | undefined> {
  const release = await httpsGetJson(GITHUB_RELEASES_API);
  const tag = release.tag_name;
  const version = tag.replace(/^v/i, "");
  const jarAsset = release.assets.find((a) => a.name.endsWith(".jar"));
  if (!jarAsset) {
    return undefined;
  }
  return { tag, version, jarUrl: jarAsset.browser_download_url };
}

// ── File download ──────────────────────────────────────────────────

function downloadFile(
  url: string,
  dest: string,
  progress: vscode.Progress<{ message?: string; increment?: number }>,
  token: vscode.CancellationToken
): Promise<boolean> {
  return new Promise((resolve) => {
    const file = fs.createWriteStream(dest);
    let cancelled = false;

    token.onCancellationRequested(() => {
      cancelled = true;
      file.close();
      try { fs.unlinkSync(dest); } catch { /* ignore */ }
      resolve(false);
    });

    const get = (requestUrl: string, redirects = 0) => {
      if (cancelled || redirects > 5) {
        file.close();
        try { fs.unlinkSync(dest); } catch { /* ignore */ }
        resolve(false);
        return;
      }

      https
        .get(requestUrl, { headers: { "User-Agent": "vscode-lucli" } }, (res) => {
          if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
            get(res.headers.location, redirects + 1);
            return;
          }
          if (res.statusCode !== 200) {
            file.close();
            try { fs.unlinkSync(dest); } catch { /* ignore */ }
            resolve(false);
            return;
          }

          const totalBytes = parseInt(res.headers["content-length"] || "0", 10);
          let received = 0;

          res.on("data", (chunk: Buffer) => {
            received += chunk.length;
            if (totalBytes > 0) {
              const pct = Math.round((received / totalBytes) * 100);
              progress.report({ message: `Downloading LuCLI… ${pct}%` });
            }
          });

          res.pipe(file);
          file.on("finish", () => { file.close(); resolve(true); });
          file.on("error", () => {
            file.close();
            try { fs.unlinkSync(dest); } catch { /* ignore */ }
            resolve(false);
          });
        })
        .on("error", () => {
          file.close();
          try { fs.unlinkSync(dest); } catch { /* ignore */ }
          resolve(false);
        });
    };

    get(url);
  });
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Download (or update to) the latest LuCLI JAR from GitHub.
 * Returns the path to the JAR on success, or undefined.
 */
export async function downloadLatestJar(
  outputChannel?: vscode.OutputChannel
): Promise<string | undefined> {
  const javaOk = await checkJavaAvailable();
  if (!javaOk) {
    void vscode.window.showErrorMessage(
      "Java 17+ is required to run LuCLI. Please install Java and try again."
    );
    return undefined;
  }

  if (!storageBinDir) {
    void vscode.window.showErrorMessage("Extension storage not initialised.");
    return undefined;
  }

  // Fetch release metadata
  let release: ReleaseInfo | undefined;
  try {
    release = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "LuCLI", cancellable: false },
      async (progress) => {
        progress.report({ message: "Checking for latest release…" });
        return fetchLatestRelease();
      }
    );
  } catch {
    void vscode.window.showErrorMessage(
      "Could not reach GitHub. Check your internet connection."
    );
    return undefined;
  }

  if (!release) {
    void vscode.window.showErrorMessage(
      "No JAR asset found in the latest LuCLI release."
    );
    return undefined;
  }

  fs.mkdirSync(storageBinDir, { recursive: true });

  const jarName = `lucli-${release.version}.jar`;
  const destPath = path.join(storageBinDir, jarName);

  // Already have this exact version?
  if (fs.existsSync(destPath)) {
    downloadedJarPath = destPath;
    outputChannel?.appendLine(`LuCLI ${release.version} already present at ${destPath}`);
    void vscode.window.showInformationMessage(`LuCLI ${release.version} is already up to date.`);
    return destPath;
  }

  // Download
  const ok = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "LuCLI", cancellable: true },
    (progress, token) => {
      progress.report({ message: `Downloading LuCLI ${release!.version}…` });
      return downloadFile(release!.jarUrl, destPath, progress, token);
    }
  );

  if (!ok) {
    void vscode.window.showErrorMessage("LuCLI download failed or was cancelled.");
    return undefined;
  }

  // Remove older downloaded JARs
  for (const f of fs.readdirSync(storageBinDir)) {
    if (f.endsWith(".jar") && f !== jarName) {
      try { fs.unlinkSync(path.join(storageBinDir, f)); } catch { /* ignore */ }
    }
  }

  downloadedJarPath = destPath;
  outputChannel?.appendLine(`Downloaded LuCLI ${release.version} to ${destPath}`);
  void vscode.window.showInformationMessage(`LuCLI ${release.version} downloaded successfully.`);
  return destPath;
}

/**
 * If LuCLI cannot be found via config, downloaded JAR, or PATH,
 * prompt the user to download it.
 */
export async function promptDownloadIfNeeded(
  outputChannel?: vscode.OutputChannel
): Promise<void> {
  if (getEffectiveLucliPath()) {
    return; // Config or downloaded JAR already available
  }

  // Check PATH
  const onPath = await new Promise<boolean>((resolve) => {
    execFile("lucli", ["--version"], (err) => resolve(!err));
  });
  if (onPath) {
    return;
  }

  const choice = await vscode.window.showInformationMessage(
    "LuCLI was not found. Would you like to download the latest version?",
    "Download",
    "Not Now"
  );

  if (choice === "Download") {
    await downloadLatestJar(outputChannel);
  }
}
