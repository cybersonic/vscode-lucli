export const TOP_LEVEL_COMMANDS = [
  "ls", "dir", "cd", "pwd", "mkdir", "rmdir", "rm", "cp", "mv",
  "cat", "edit", "touch", "find", "wc", "head", "tail", "run", "prompt",
  "exit", "quit", "clear", "history", "env", "echo",
  "server", "modules", "cfml", "lint", "help"
];

export interface SubcommandInfo {
  options: string[];
}

export interface CommandInfo {
  subcommands?: { [name: string]: SubcommandInfo };
  options?: string[];
}

export const COMMAND_TREE: { [command: string]: CommandInfo } = {
  server: {
    subcommands: {
      start:  { options: ["--version", "-v", "--name", "-n", "--port", "-p", "--force", "-f"] },
      stop:   { options: ["--name", "-n"] },
      status: { options: ["--name", "-n"] },
      list:   { options: [] },
      log:    { options: ["--name", "-n", "--type", "-t", "--follow", "-f"] },
      monitor:{ options: ["--name", "-n"] },
      prune:  { options: ["--name", "-n", "--all", "-a"] },
      config: { options: ["--no-cache"] },
      debug:  { options: [] }
    }
  },
  modules: {
    subcommands: {
      list:    { options: [] },
      init:    { options: [] },
      run:     { options: [] },
      install: { options: ["--url", "-u"] }
    }
  },
  cfml: {
    options: []
  },
  lint: {
    options: []
  },
  help: {
    options: []
  }
};
