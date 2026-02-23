import * as vscode from "vscode";
import { spawn } from "child_process";
import type { ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as net from "net";
import { TOP_LEVEL_COMMANDS, COMMAND_TREE } from "./commandsData";
import { initResolver, getEffectiveLucliPath, downloadLatestJar, promptDownloadIfNeeded } from "./lucliResolver";

let daemonProcess: ChildProcess | undefined;
let outputChannel: vscode.OutputChannel | undefined;

export function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel("LuCLI");

  // Resolve lucli location (config → downloaded JAR → PATH)
  initResolver(context);
  void promptDownloadIfNeeded(outputChannel);

  const provider = new LucliCompletionProvider();

  const completionDisposable = vscode.languages.registerCompletionItemProvider(
    { language: "lucli" },
    provider,
    " ", "-", "\t"
  );

  const runCommandDisposable = vscode.commands.registerCommand(
    "lucli.runFile",
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== "lucli") {
        vscode.window.showErrorMessage("No active LuCLI file to run.");
        return;
      }

      // Ensure latest changes are saved before running
      await editor.document.save();

      const filePath = editor.document.uri.fsPath;
      const lucliPath = getEffectiveLucliPath();

      let command: string;
      let args: string[] = [];

      if (!lucliPath) {
        // Assume 'lucli' is available on PATH
        command = "lucli";
        args = [filePath];
      } else if (lucliPath.toLowerCase().endsWith(".jar")) {
        // Run via java -jar path/to/lucli.jar script.lucli
        command = "java";
        args = ["-jar", lucliPath, filePath];
      } else {
        // Direct binary path
        command = lucliPath;
        args = [filePath];
      }

      const terminal = vscode.window.createTerminal({
        name: "LuCLI",
        cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      });

      const fullCommand = [command, ...args].join(" ");
      terminal.show(true);
      terminal.sendText(fullCommand, true);
    }
  );

  // Linting via Lucee Lint (pattern 2: direct diagnostics)
  const diagnosticCollection = vscode.languages.createDiagnosticCollection("lucee-lint");

  const startFromLuceeJson = vscode.commands.registerCommand(
    "lucli.server.startFromLuceeJson",
    async (uri?: vscode.Uri) => {
      const targetUri = await resolveLuceeJsonUri(uri);
      if (!targetUri) {
        return;
      }

      await runLucliServerCommandFromLuceeJson(targetUri, [
        "server",
        "start",
        `file=${targetUri.fsPath}`,
      ]);
    }
  );

  const stopFromLuceeJson = vscode.commands.registerCommand(
    "lucli.server.stopFromLuceeJson",
    async (uri?: vscode.Uri) => {
      const targetUri = await resolveLuceeJsonUri(uri);
      if (!targetUri) {
        return;
      }

      const config = await readJsonFile<{ name?: string }>(targetUri);
      if (!config || !config.name) {
        void vscode.window.showErrorMessage(
          "lucee.json does not define a 'name' property; cannot stop server by name."
        );
        return;
      }

      await runLucliServerCommandFromLuceeJson(targetUri, [
        "server",
        "stop",
        `name=${config.name}`,
      ]);
    }
  );

  const openWebrootFromLuceeJson = vscode.commands.registerCommand(
    "lucli.server.openWebrootFromLuceeJson",
    async (uri?: vscode.Uri) => {
      const targetUri = await resolveLuceeJsonUri(uri);
      if (!targetUri) {
        return;
      }

      const config = await readJsonFile<{ webroot?: string }>(targetUri);
      if (!config || !config.webroot) {
        void vscode.window.showErrorMessage(
          "lucee.json does not define a 'webroot' property."
        );
        return;
      }

      const webrootPath = path.isAbsolute(config.webroot)
        ? config.webroot
        : path.resolve(path.dirname(targetUri.fsPath), config.webroot);

      const webrootUri = vscode.Uri.file(webrootPath);
      await vscode.commands.executeCommand("vscode.openFolder", webrootUri, true);
    }
  );

  const openInBrowserFromLuceeJson = vscode.commands.registerCommand(
    "lucli.server.openInBrowserFromLuceeJson",
    async (uri?: vscode.Uri) => {
      const targetUri = await resolveLuceeJsonUri(uri);
      if (!targetUri) {
        return;
      }

      const config = await readJsonFile<{ port?: number | string }>(targetUri);
      if (!config || config.port === undefined || config.port === null) {
        void vscode.window.showErrorMessage(
          "lucee.json does not define a 'port' property."
        );
        return;
      }

      const port = String(config.port);
      const url = vscode.Uri.parse(`http://localhost:${port}/`);
      await vscode.env.openExternal(url);
    }
  );

  const lintDocument = async (document: vscode.TextDocument) => {
    if (document.languageId !== "cfml" && document.languageId !== "lucee") {
      return;
    }

    const lintEnabled = vscode.workspace.getConfiguration().get<boolean>("lucli.lint.enabled", false);
    if (!lintEnabled) {
      return;
    }

    outputChannel?.appendLine(`Linting ${document.uri.fsPath}`);

    const lucliPath = getEffectiveLucliPath();
    const config = vscode.workspace.getConfiguration();
    const useDaemon = config.get<boolean>("lucli.daemon.enabled", false);
    const daemonPort = config.get<number>("lucli.daemon.port", 10000);
    const filePath = document.uri.fsPath;

    try {
      const output = useDaemon
        ? await runLucliLintViaDaemon(lucliPath, filePath, daemonPort)
        : await runLucliLintWithProcess(lucliPath, filePath, document);

      const diagnostics = parseTscOutputToDiagnostics(output, document.uri);
      outputChannel?.appendLine(output);
      diagnosticCollection.set(document.uri, diagnostics);
    } catch (err) {
      console.error("Lucee lint failed", err);
      outputChannel?.appendLine(
        `Lucee lint failed for ${document.uri.fsPath}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      diagnosticCollection.delete(document.uri);
    }
  };

  const openDisposable = vscode.workspace.onDidOpenTextDocument(lintDocument);
  const saveDisposable = vscode.workspace.onDidSaveTextDocument(lintDocument);

  // Optionally lint already-open documents on activation
  vscode.workspace.textDocuments.forEach(doc => {
    void lintDocument(doc);
  });

  // const taskProvider = vscode.tasks.registerTaskProvider("luceeLint", {
  //   provideTasks(): vscode.Task[] {
  //     const shellExecution = new vscode.ShellExecution("lucli", ["lint", "file=${file}", "format=tsc"]);
  //     const task = new vscode.Task(
  //       { type: "luceeLint" },
  //       vscode.TaskScope.Workspace,
  //       "Lucee Lint",
  //       "luceeLint",
  //       shellExecution,
  //       "$tsc"
  //     );
  //     return [task];
  //   },
  //   resolveTask(_task: vscode.Task): vscode.Task | undefined {
  //     return undefined;
  //   },
  // });

  const downloadDisposable = vscode.commands.registerCommand(
    "lucli.download",
    () => downloadLatestJar(outputChannel)
  );

  context.subscriptions.push(
    completionDisposable,
    runCommandDisposable,
    diagnosticCollection,
    openDisposable,
    saveDisposable,
    // taskProvider,
    startFromLuceeJson,
    stopFromLuceeJson,
    openWebrootFromLuceeJson,
    openInBrowserFromLuceeJson,
    downloadDisposable
  );
}

export function deactivate() {
  if (daemonProcess && daemonProcess.pid && daemonProcess.exitCode == null) {
    try {
      daemonProcess.kill();
    } catch {
      // ignore
    }
  }

  outputChannel?.dispose();
}

function buildLucliLintCommand(lucliPath: string, filePath: string): { command: string; args: string[] } {
  if (!lucliPath) {
    return {
      command: "lucli",
      args: ["lint", `file=${filePath}`, "format=tsc"],
    };
  }

  if (lucliPath.toLowerCase().endsWith(".jar")) {
    return {
      command: "java",
      args: ["-jar", lucliPath, "lint", `file=${filePath}`, "format=tsc"],
    };
  }

  return {
    command: lucliPath,
    args: ["lint", `file=${filePath}`, "format=tsc"],
  };
}

async function resolveLuceeJsonUri(uri?: vscode.Uri): Promise<vscode.Uri | undefined> {
  if (uri && uri.fsPath.toLowerCase().endsWith("lucee.json")) {
    return uri;
  }

  const active = vscode.window.activeTextEditor?.document;
  if (active && active.uri.fsPath.toLowerCase().endsWith("lucee.json")) {
    return active.uri;
  }

  void vscode.window.showErrorMessage(
    "No lucee.json file selected. Use this command from the Explorer context menu or with lucee.json active."
  );
  return undefined;
}

async function runLucliServerCommandFromLuceeJson(
  uri: vscode.Uri,
  serverArgs: string[]
): Promise<void> {
  const lucliPath = getEffectiveLucliPath();

  let command: string;
  let args: string[];

  if (!lucliPath) {
    command = "lucli";
    args = serverArgs;
  } else if (lucliPath.toLowerCase().endsWith(".jar")) {
    command = "java";
    args = ["-jar", lucliPath, ...serverArgs];
  } else {
    command = lucliPath;
    args = serverArgs;
  }

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
  const cwd = workspaceFolder?.uri.fsPath ?? path.dirname(uri.fsPath);

  const terminal = vscode.window.createTerminal({
    name: "LuCLI",
    cwd,
  });

  const fullCommand = [command, ...args].join(" ");
  terminal.show(true);
  terminal.sendText(fullCommand, true);
}

async function readJsonFile<T = any>(uri: vscode.Uri): Promise<T | undefined> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    const text = Buffer.from(bytes).toString("utf8");
    return JSON.parse(text) as T;
  } catch (err) {
    console.error("Failed to read JSON file", uri.fsPath, err);
    void vscode.window.showErrorMessage(
      `Failed to read JSON from ${uri.fsPath}: ${err instanceof Error ? err.message : String(err)}`
    );
    return undefined;
  }
}

async function runLucliLintWithProcess(
  lucliPath: string,
  filePath: string,
  document: vscode.TextDocument
): Promise<string> {
  const { command, args } = buildLucliLintCommand(lucliPath, filePath);
  if (outputChannel) {
    outputChannel.appendLine(`Running lucli lint via process: ${command} ${args.join(" ")}`);
  }
  return "";
  // return runLucliLintProcess(command, args);
}

function runLucliLintProcess(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    return;
    const proc = spawn(command, args, {
      cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("error", (err) => reject(err));

    proc.on("close", (code) => {
      // lucli lint may exit with non-zero when there are lint errors; we still want the output
      if (code !== 0 && !stdout && stderr) {
        return reject(new Error(stderr));
      }
      resolve(stdout || stderr);
    });
  });
}

interface DaemonResponse {
  id?: string;
  exitCode: number;
  output: string;
}

async function runLucliLintViaDaemon(
  lucliPath: string,
  filePath: string,
  port: number
): Promise<string> {

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath));
  const cwdOverride = workspaceFolder?.uri.fsPath ?? path.dirname(filePath);

  // cwdOverride


  const argv = ["lint", `file=${filePath}`, "format=tsc", `cwdOverride=${cwdOverride}`];

  outputChannel?.appendLine(
    `Running lucli lint via daemon on port ${port}: ${argv.join(" ")}`
  );

  await ensureLucliDaemonRunning(lucliPath, port);
  const response = await sendDaemonRequest(port, argv);

  outputChannel?.appendLine(`Daemon response: ${JSON.stringify(response)}`);

  if (response.exitCode !== 0 && !response.output) {
    throw new Error(`lucli daemon lint failed with exit code ${response.exitCode}`);
  }

  return response.output || "";
}

function buildLucliDaemonCommand(lucliPath: string, port: number): { command: string; args: string[] } {
  const portStr = String(port);

  if (!lucliPath) {
    return {
      command: "lucli",
      args: ["daemon", "--port", portStr],
    };
  }

  if (lucliPath.toLowerCase().endsWith(".jar")) {
    return {
      command: "java",
      args: ["-jar", lucliPath, "daemon", "--port", portStr],
    };
  }

  return {
    command: lucliPath,
    args: ["daemon", "--port", portStr],
  };
}

async function ensureLucliDaemonRunning(lucliPath: string, port: number): Promise<void> {
  const alreadyListening = await isDaemonListening(port);
  if (alreadyListening) {
    return;
  }

  if (!daemonProcess || daemonProcess.exitCode != null) {
    const { command, args } = buildLucliDaemonCommand(lucliPath, port);
    if (outputChannel) {
      outputChannel.appendLine(`Starting lucli daemon on port ${port}: ${command} ${args.join(" ")}`);
    }
    daemonProcess = spawn(command, args, {
      cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      detached: false,
      stdio: "ignore",
    });
  }

  // Poll until the daemon socket is accepting connections or timeout
  const maxAttempts = 20;
  const delayMs = 250;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (await isDaemonListening(port)) {
      if (outputChannel) {
        outputChannel.appendLine(`lucli daemon is now listening on port ${port}`);
      }
      return;
    }
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }

  const msg = `Timed out waiting for lucli daemon on port ${port}`;
  if (outputChannel) {
    outputChannel.appendLine(msg);
  }
  throw new Error(msg);
}

function isDaemonListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host: "127.0.0.1" });

    const finish = (result: boolean) => {
      socket.removeAllListeners();
      if (!socket.destroyed) {
        socket.destroy();
      }
      resolve(result);
    };

    socket.once("error", () => finish(false));
    socket.once("connect", () => finish(true));
  });
}

function sendDaemonRequest(port: number, argv: string[]): Promise<DaemonResponse> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ port, host: "127.0.0.1" });

    let buffer = "";

    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
    });

    socket.once("error", (err) => {
      reject(err);
    });

    socket.once("end", () => {
      const line = buffer.trim().split(/\r?\n/)[0] ?? "";
      try {
        const parsed = JSON.parse(line) as DaemonResponse;
        resolve(parsed);
      } catch (e) {
        reject(
          new Error(
            `Invalid JSON response from lucli daemon: ${
              e instanceof Error ? e.message : String(e)
            }. Raw: ${line}`
          )
        );
      }
    });

    socket.once("connect", () => {
      const payload = JSON.stringify({ id: "vscode-lucli", argv }) + "\n";
      socket.write(payload, "utf8", () => {
        socket.end();
      });
    });
  });
}

function parseTscOutputToDiagnostics(output: string, uri: vscode.Uri): vscode.Diagnostic[] {
  const diagnostics: vscode.Diagnostic[] = [];

  const lines = output.split(/\r?\n/);
  // Example:
  // /path/file.cfc(1,0,13,2): info: [ COMPONENT_INVALID_NAME ]  Message text
  const tscRegex = /^(.*)\((\d+),(\d+),(\d+),(\d+)\):\s+(info|warning|error):\s+\[\s*([^\]]+)\s*\]\s+(.*)$/;

  for (const line of lines) {
    const match = tscRegex.exec(line.trim());
    if (!match) {
      continue;
    }

    const file = match[1];
    const startLine = Number(match[2]) - 1;
    const startCol = Number(match[3]);
    const endLine = Number(match[4]) - 1;
    const endCol = Number(match[5]);
    const severityStr = match[6].toLowerCase();
    const code = match[7];
    const message = match[8];

    let severity = vscode.DiagnosticSeverity.Error;
    if (severityStr === "warning") {
      severity = vscode.DiagnosticSeverity.Warning;
    } else if (severityStr === "info") {
      severity = vscode.DiagnosticSeverity.Information;
    }

    const range = new vscode.Range(
      new vscode.Position(startLine, Math.max(0, startCol)),
      new vscode.Position(endLine, Math.max(0, endCol))
    );

    const diagnostic = new vscode.Diagnostic(range, message, severity);
    diagnostic.source = "lucee-lint";
    diagnostic.code = code;

    diagnostics.push(diagnostic);
  }

  return diagnostics;
}

class LucliCompletionProvider implements vscode.CompletionItemProvider {
  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
    context: vscode.CompletionContext
  ): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList> {
    const lineText = document.lineAt(position.line).text;
    const beforeCursor = lineText.slice(0, position.character);

    const trimmedLeft = beforeCursor.replace(/^\s+/, "");
    if (trimmedLeft.startsWith("#")) {
      return [];
    }

    const prefixOffset = beforeCursor.length - trimmedLeft.length;
    const tokens = trimmedLeft.split(/\s+/).filter(Boolean);

    const currentWordMatch = beforeCursor.match(/[^\s]*$/);
    const currentPrefix = currentWordMatch ? currentWordMatch[0] : "";

    if (tokens.length === 0) {
      return this.completeTopLevelCommands("");
    }

    const first = tokens[0];

    if (tokens.length === 1) {
      return this.completeTopLevelCommands(currentPrefix);
    }

    const second = tokens[1];

    if (first === "server") {
      if (tokens.length === 2 && !second.startsWith("-")) {
        return this.completeSubcommands("server", currentPrefix);
      }

      if (tokens.length >= 3) {
        const sub = second;
        const currentToken = currentPrefix;
        if (currentToken.startsWith("-")) {
          return this.completeOptions("server", sub, currentToken);
        }
      }
    }

    if (first === "modules") {
      if (tokens.length === 2 && !second.startsWith("-")) {
        return this.completeSubcommands("modules", currentPrefix);
      }

      if (tokens.length >= 3) {
        const sub = second;
        const currentToken = currentPrefix;
        if (currentToken.startsWith("-")) {
          return this.completeOptions("modules", sub, currentToken);
        }
      }
    }

    if (first === "cfml" || first === "lint") {
      return [];
    }

    return [];
  }

  private completeTopLevelCommands(prefix: string): vscode.CompletionItem[] {
    return TOP_LEVEL_COMMANDS
      .filter(cmd => cmd.startsWith(prefix))
      .map(cmd => {
        const item = new vscode.CompletionItem(cmd, vscode.CompletionItemKind.Function);
        item.insertText = cmd;
        return item;
      });
  }

  private completeSubcommands(command: string, prefix: string): vscode.CompletionItem[] {
    const info = COMMAND_TREE[command];
    if (!info || !info.subcommands) {
      return [];
    }

    return Object.keys(info.subcommands)
      .filter(sub => sub.startsWith(prefix))
      .map(sub => {
        const item = new vscode.CompletionItem(sub, vscode.CompletionItemKind.Keyword);
        item.insertText = sub;
        return item;
      });
  }

  private completeOptions(command: string, subcommand: string, prefix: string): vscode.CompletionItem[] {
    const info = COMMAND_TREE[command];
    const sub = info && info.subcommands ? info.subcommands[subcommand] : undefined;
    const options = sub ? sub.options : info?.options || [];

    return options
      .filter(opt => opt.startsWith(prefix))
      .map(opt => {
        const item = new vscode.CompletionItem(opt, vscode.CompletionItemKind.Field);
        item.insertText = opt;
        return item;
      });
  }
}
