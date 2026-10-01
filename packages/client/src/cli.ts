import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, saveConfig, homeDir } from "./config.js";
import { firstRunNotice } from "./guidance.js";
import { createServer } from "./server.js";
import { VERSION } from "./version.js";

const HELP = `sitelore ${VERSION} — community operating experience for AI browser agents
(work in progress: there is no public data repo or intake service yet, and this package is not on npm)

Usage:
  sitelore            Start the MCP server on stdio (what your agent runs)
  sitelore init       Show the contribution notice and how to add Sitelore to your agent
  sitelore off        Stop contributing (lookups keep working)
  sitelore on         Resume contributing
  sitelore github on  Submit as PRs from your own GitHub account (public under your name)
  sitelore github off Submit through the Sitelore intake service (default)
  sitelore status     Show current settings

Add a from-source build to Claude Code (see README.md):
  claude mcp add sitelore -e SITELORE_DATA_REPO=<owner/repo> -e SITELORE_RECORD_ONLY=1 -- node <path>/packages/client/dist/cli.js

Configuration comes from ~/.sitelore/config.json plus SITELORE_* environment
variables; "status" only sees the environment of the shell it runs in.
`;

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? "mcp";
  switch (cmd) {
    case "mcp": {
      const { config } = loadConfig();
      const server = createServer({ config });
      await server.connect(new StdioServerTransport());
      return;
    }
    case "init":
      console.log(firstRunNotice(loadConfig().config.channel !== "intake") + "\n");
      console.log(HELP);
      saveConfig({ noticeShown: true });
      return;
    case "off":
      saveConfig({ contribute: false });
      console.log("Contribution is off. Your agent will still get Sitelore notes, but will not submit any.");
      return;
    case "on":
      saveConfig({ contribute: true });
      console.log("Contribution is on. Thank you!");
      return;
    case "github": {
      const on = process.argv[3] === "on";
      if (!on && process.argv[3] !== "off") {
        console.error(HELP);
        process.exitCode = 1;
        return;
      }
      saveConfig({ channel: on ? "auto" : "intake" });
      console.log(
        on
          ? "Submissions will be opened as pull requests from your own GitHub account (via GITHUB_TOKEN or `gh auth token`). Your GitHub username will be public on those PRs."
          : "Submissions will go through the Sitelore intake service; your GitHub account is not used.",
      );
      return;
    }
    case "status": {
      const { config } = loadConfig();
      console.log(JSON.stringify({ version: VERSION, home: homeDir(), ...config }, null, 2));
      return;
    }
    case "-h":
    case "--help":
    case "help":
      console.log(HELP);
      return;
    case "-v":
    case "--version":
      console.log(VERSION);
      return;
    default:
      console.error(`Unknown command: ${cmd}\n\n${HELP}`);
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
