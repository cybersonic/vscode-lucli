# vscode-lucli

Basic VS Code support for [LuCLI](https://github.com/lucee/lucli) `.lucli` scripts.

## Features

- Treats `.lucli` files as a dedicated language
- Syntax highlighting for:
  - Shebang line (`#!/usr/bin/env lucli`)
  - `#` comments
  - First word commands (e.g. `server`, `modules`, `cfml`, `lint`, `ls`, `cd`)
  - Known `server` / `modules` subcommands
  - Flags / options like `--version`, `--name`, `--port`
  - Strings and numbers
- Simple completion:
  - First token: LuCLI/internal commands
  - Second token for `server` / `modules`: known subcommands
  - Later tokens starting with `-`: options for that subcommand
- JSON schema–aware support for LuCLI configuration files:
  - Validation and IntelliSense for `lucee.json` project server configuration files.
  - Validation and IntelliSense for `module.json` LuCLI module metadata files.

### LuCLI configuration files

This extension understands the standard JSON files that LuCLI itself reads and writes, and gives you editor feedback while you edit them.

#### `lucee.json` (project server configuration)

When you have a `lucee.json` in your workspace, the extension:

- Applies the published `lucee.json` JSON Schema from `https://lucli.dev/schemas/v1/lucee.schema.json`.
- Offers key and value completion for the known LuCLI server settings (for example `name`, `version`, `port`, `webroot`, `monitoring`, `jvm`, `urlRewrite`, `admin`, and `agents`).
- Highlights type errors (for example a string where a number is expected) and unknown properties.

This is the same shape that LuCLI uses when it generates or updates `lucee.json`, so what you see in VS Code matches what the CLI expects.

#### `module.json` (LuCLI module metadata)

For `module.json` files created by `lucli modules init` (usually inside your LuCLI modules directory), the extension:

- Applies the published `module.json` JSON Schema from `https://lucli.dev/schemas/v1/module.schema.json`.
- Provides completion for common metadata fields such as `name`, `version`, `description`, `author`, `license`, `keywords`, `main`, and `created`.
- Validates values against the schema so you can spot mistakes before running the module.

These schemas are versioned (currently `v1`) and served from `lucli.dev`, so other tools and editors can reuse the same definitions.

## Getting started

1. Run `npm install` in this folder to install dev dependencies.
2. Run `npm run watch` to build in watch mode.
3. Press `F5` in VS Code to launch an Extension Development Host.
4. Open or create a `.lucli` file and start typing commands.

## Notes

- Completion is currently static (no calls to the LuCLI binary).
- The command tree is defined in `src/commandsData.ts`.
- Future work: optional dynamic completion by shelling out to `lucli --complete` when available.
