# LuCLI for Visual Studio Code

First-class [LuCLI](https://lucli.dev/) support inside VS Code - write, run and lint Lucee CFML projects without leaving the editor.

<!-- TODO: ![feature-overview](images/overview.gif) -->

## Features

**Write `.lucli` scripts with full editor support**
Syntax highlighting, command completion and flag suggestions for LuCLI scripts.

<!-- TODO: ![completion](images/completion.gif) -->

**Run scripts in one click**
Run the current `.lucli` file straight from the editor title bar, context menu, or Command Palette.

<!-- TODO: ![run-file](images/run-file.gif) -->

**Manage Lucee servers from `lucee.json`**
Right-click a `lucee.json` in the Explorer to start, stop, or open a Lucee server - no terminal required.

**IntelliSense for LuCLI config files**
Schema-driven validation and autocomplete for `lucee.json`, `module.json`, and `CFConfig.json`.

**Lucee / CFML linting** (opt-in)
Real-time diagnostics on open and save powered by `lucli lint`. Enable it in settings when you're ready.

**Automatic LuCLI install**
Don't have LuCLI yet? The extension will offer to download the latest version for you (requires Java 17+).

## Commands

All commands are available from the Command Palette (`Cmd+Shift+P`):

- **LuCLI: Run LuCLI File** - run the active `.lucli` script
- **LuCLI: Download or Update LuCLI** - fetch the latest LuCLI release
- **LuCLI: Start / Stop / Open Lucee server** - server management from `lucee.json`

## Settings

| Setting | Type | Default | Description |
|---|---|---|---|
| `lucli.path` | `string` | `""` | Path to LuCLI executable or JAR. Leave empty to use the auto-downloaded JAR or `lucli` from PATH. |
| `lucli.lint.enabled` | `boolean` | `false` | Enable Lucee linting on open and save for CFML / Lucee files. |
| `lucli.daemon.enabled` | `boolean` | `true` | Use the LuCLI daemon for faster linting. Only applies when linting is enabled. |
| `lucli.daemon.port` | `number` | `10000` | TCP port for the LuCLI lint daemon. |

## Configuration files

The extension provides JSON Schema support for LuCLI's configuration files. You get validation, autocomplete and hover documentation out of the box for:

- **`lucee.json`** - project server configuration (`name`, `port`, `webroot`, `jvm`, etc.)
- **`module.json`** - LuCLI module metadata (`name`, `version`, `main`, `keywords`, etc.)
- **`CFConfig.json`** - Lucee engine configuration

Schemas are loaded from [lucli.dev](https://lucli.dev/) and versioned independently.

## Contributing

1. `npm install`
2. `npm run watch`
3. Press **F5** to launch an Extension Development Host.
4. Open or create a `.lucli` file to exercise the extension.

See [AGENTS.md](AGENTS.md) for architecture notes and coding guidelines.
