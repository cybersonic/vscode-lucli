# AGENTS.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Common commands

All commands are run from the repository root (`vscode-lucli`). This is a standard VS Code extension project using TypeScript and `vsce`.

### Install dependencies

```bash
npm install
```

### Build / type-check

Single build (TypeScript compile via `tsc`):

```bash
npm run compile
```

Watch mode during development (recommended):

```bash
npm run watch
```

VS Code will run `npm run compile` automatically before publishing via the `vscode:prepublish` script.

### Run the extension in VS Code

Typical development loop:

1. Ensure dependencies are installed: `npm install`.
2. Start TypeScript watch build: `npm run watch`.
3. In VS Code, use the **Run > Start Debugging** command or press **F5** to launch an **Extension Development Host**.
4. Open or create a `.lucli` file in the Extension Development Host to exercise language features and the `LuCLI: Run LuCLI File` command.

### Packaging and publishing the extension

These commands use `vsce` and assume the appropriate marketplace auth is already configured (do not add or modify auth from the agent):

- Package VS Code extension:

  ```bash
  npm run package
  ```

- Publish current version:

  ```bash
  npm run publish
  ```

- Version bump + package + publish:

  ```bash
  npm run release:patch
  npm run release:minor
  npm run release:major
  ```

Use these only when explicitly asked to prepare a release.

### Tests

There is a placeholder test script only:

```bash
npm test
```

This currently just echoes `"No tests yet"`. There is no test framework wired up, so do not assume Jest/Mocha/etc. exist.

## High-level architecture

This repository implements a lightweight VS Code extension that provides language support for LuCLI `.lucli` scripts, and some Lucee/CFML tooling via the `lucli` CLI.

### Core extension entrypoint

- **File:** `src/extension.ts`
- **Exports:** `activate(context)` and `deactivate()`.
- **Activation:** Controlled by `activationEvents` in `package.json`:
  - `onLanguage:lucli`, `onLanguage:cfml`, `onLanguage:lucee`.
  - `onCommand:lucli.runFile`.

In `activate` the extension wires up three main capabilities:

1. **Completion provider for `.lucli` files**
   - Registered via `vscode.languages.registerCompletionItemProvider` for language id `lucli`.
   - Implementation is `LucliCompletionProvider` in `src/extension.ts`.
   - Uses static command metadata from `src/commandsData.ts` (`TOP_LEVEL_COMMANDS` and `COMMAND_TREE`).
   - Behavior:
     - Ignores commented lines (starting with `#`).
     - First token completion: top-level LuCLI/internal commands (e.g. `server`, `modules`, `cfml`, `lint`, shell-like commands).
     - Second token completion for `server` and `modules`: subcommands defined in `COMMAND_TREE`.
     - Later tokens that start with `-`: option/flag completion pulled from the per-subcommand `options` arrays.

2. **`lucli.runFile` command**
   - Registered via `vscode.commands.registerCommand("lucli.runFile", ...)`.
   - Only runs when the active editor is a `lucli` document; otherwise shows an error message.
   - Saves the active document, then determines how to invoke LuCLI based on the `lucli.path` configuration value:
     - If empty: assumes `lucli` is on `PATH` and runs `lucli <file>`.
     - If ends with `.jar` (case-insensitive): runs `java -jar <path-to-jar> <file>`.
     - Otherwise: treats `lucli.path` as a direct binary path and runs `<lucli.path> <file>`.
   - Spawns a VS Code integrated terminal named **"LuCLI"**, with `cwd` set to the first workspace folder, and sends the full command line for the user to see and interact with.

3. **Lucee lint diagnostics and tasks**
   - Maintains a `vscode.DiagnosticCollection` named `"lucee-lint"`.
   - On open and on save of documents with language ids `cfml` or `lucee`, it calls `lintDocument` which:
     - Reads the `lucli.path` setting as above.
     - Builds a `lucli lint` command using `buildLucliLintCommand`:
       - No path configured: `lucli lint file=<fsPath> format=tsc`.
       - `.jar` path: `java -jar <jar> lint file=<fsPath> format=tsc`.
       - Binary path: `<lucliPath> lint file=<fsPath> format=tsc`.
     - Spawns the CLI via `child_process.spawn` in the workspace folder.
     - Collects stdout/stderr and passes the output through `parseTscOutputToDiagnostics`.
   - `parseTscOutputToDiagnostics` expects `format=tsc`-style output:
     - Regex parses lines of the form: `path(lnStart,colStart,lnEnd,colEnd): <severity>: [ CODE ] Message`.
     - Maps severities (info / warning / error) to `vscode.DiagnosticSeverity`.
     - Translates the positions into a `vscode.Range` and populates `diagnostic.source = "lucee-lint"` and `diagnostic.code = <lint code>`.
   - Task integration:
     - Registers a `vscode.tasks.registerTaskProvider` for type `"luceeLint"`.
     - Provides a single `vscode.Task` that runs `lucli lint file=${file} format=tsc` via `vscode.ShellExecution` and uses the `$tsc` problem matcher.
     - This complements the on-save/on-open diagnostics so that users can also run Lucee lint as a VS Code task.

### Command metadata

- **File:** `src/commandsData.ts`
- Defines the structure used by the completion provider:
  - `TOP_LEVEL_COMMANDS`: flat list of top-level LuCLI/shell-like commands.
  - `COMMAND_TREE`: map from command name to:
    - Optional `subcommands` map, each with an `options: string[]` list.
    - Optional top-level `options` for commands without subcommands.
- Current focus is on `server`, `modules`, `cfml`, `lint`, and `help`, with representative options for common workflows (e.g. `--version`, `--name`, `--port`).
- There is no dynamic discovery of commands; completion is entirely static and based on this file.

### Language configuration and syntax

- **File:** `language-configuration.json`
  - Configures comment style (`#`), bracket pairs, auto-closing pairs, and `wordPattern` for the `lucli` language.
- **TextMate grammar:** configured in `package.json` under `contributes.grammars` as `syntaxes/lucli.tmLanguage.json` (not manipulated directly from the extension code).

### JSON schema integration

JSON schema support is entirely declarative in `package.json` via `contributes.jsonValidation`:

- `lucee.json` and similar file patterns point to `https://lucli.dev/schemas/v1/lucee.schema.json`.
- `CFConfig.json` variations point to `https://lucee.org/schemas/v1/lucee.config.schema.json`.
- `module.json` points to `https://lucli.dev/schemas/v1/module.schema.json`.

VS Code's built-in JSON language server handles validation and IntelliSense; the extension does not implement additional JSON parsing logic.

### VS Code contributions overview (`package.json`)

Key `contributes` areas from `package.json` that matter when changing behavior:

- `languages`
  - Defines the `lucli` language id, aliases, file extension (`.lucli`), and links it to `language-configuration.json`.
- `grammars`
  - Binds the `lucli` TextMate grammar (`syntaxes/lucli.tmLanguage.json`) to the `source.lucli` scope.
- `taskDefinitions`
  - Adds a `"Lucee Lint"` task definition type used by the task provider in `extension.ts`.
- `commands`
  - Exposes `lucli.runFile` as `"Run LuCLI File"` in the Command Palette.
- `menus`
  - Adds `lucli.runFile` to the editor title and context menus when the active document has `resourceLangId == lucli`.
- `configuration`
  - Introduces the `lucli.path` setting used to locate the LuCLI executable or JAR.

## Notes for future agents

- There are currently no automated tests. If you add tests, ensure the chosen test runner is wired into `npm test` rather than assuming an existing framework.
- Any changes to syntax highlighting or language id must be coordinated between `package.json` (`languages`, `grammars`), `language-configuration.json`, and the logic in `src/extension.ts` that registers providers/commands.
- When modifying the linting behavior, keep `buildLucliLintCommand`, `runLucliLint`, and `parseTscOutputToDiagnostics` logically in sync so that the CLI output format still matches the diagnostic parser.
- The extension depends on an external `lucli` CLI for running scripts and linting; avoid hard-coding paths and continue to respect the `lucli.path` configuration for portability.