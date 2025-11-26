# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- JSON schema–based validation and IntelliSense for `lucee.json` project server configuration files and `module.json` LuCLI module metadata files, using the published schemas at `https://lucli.dev/schemas/v1/`.

## [0.0.1] - 2025-11-24

### Added
- Initial LuCLI VS Code extension with:
  - Language registration for `.lucli` files (syntax highlighting via TextMate grammar and language configuration).
  - Basic completion provider for top-level LuCLI commands, subcommands, and options (e.g. `server`, `modules`, `cfml`, `lint`).
- New command **"LuCLI: Run LuCLI File"** (`lucli.runFile`):
  - Runs the currently active `.lucli` file in a VS Code terminal.
  - Uses `lucli <file>` when `lucli` is available on `PATH`.
  - Supports a configurable `lucli.path` setting:
    - If set to a `.jar`, runs `java -jar <lucli.jar> <file>`.
    - Otherwise treats it as a direct LuCLI binary path and runs `<lucli.path> <file>`.
  - Adds editor title and context menu entries for `.lucli` files to trigger the command.
