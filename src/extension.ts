import * as vscode from "vscode";
import { TOP_LEVEL_COMMANDS, COMMAND_TREE } from "./commandsData";

export function activate(context: vscode.ExtensionContext) {
  const provider = new LucliCompletionProvider();

  const disposable = vscode.languages.registerCompletionItemProvider(
    { language: "lucli" },
    provider,
    " ", "-", "\t"
  );

  context.subscriptions.push(disposable);
}

export function deactivate() {
  // nothing to clean up for now
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
