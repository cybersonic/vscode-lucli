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

## Getting started

1. Run `npm install` in this folder to install dev dependencies.
2. Run `npm run watch` to build in watch mode.
3. Press `F5` in VS Code to launch an Extension Development Host.
4. Open or create a `.lucli` file and start typing commands.

## Notes

- Completion is currently static (no calls to the LuCLI binary).
- The command tree is defined in `src/commandsData.ts`.
- Future work: optional dynamic completion by shelling out to `lucli --complete` when available.
