import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, saveConfig, homeDir } from "./config.js";
import { CONTRIBUTION_NOTICE_VERSION, firstRunNotice } from "./guidance.js";
import { createServer } from "./server.js";
import { VERSION } from "./version.js";

const HELP = `sitelore ${VERSION} — community operating experience for AI browser agents

Usage:
  sitelore            Start the MCP server on stdio (what your agent runs)
  sitelore init       Show the contribution notice and how to add Sitelore to your agent
  sitelore off        Stop contributing (lookups keep working)
  sitelore on         Resume contributing
  sitelore status     Show current settings

Add to Claude Code after installing the npm package (see README.md):
  claude mcp add sitelore -- npx -y sitelore

Official data repository: TigerkidYang/sitelore-data. Code and data use MIT.

Configuration comes from ~/.sitelore/config.json plus SITELORE_* environment
variables; "status" only sees the environment of the shell it runs in.
Contributions use your own GitHub account through GITHUB_TOKEN, GH_TOKEN or an
existing gh login. Without local credentials, contribution is skipped.
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
      console.log(firstRunNotice() + "\n");
      console.log(HELP);
      saveConfig({ noticeVersion: CONTRIBUTION_NOTICE_VERSION });
      return;
    case "off":
      saveConfig({ contribute: false });
      console.log("Contribution is off. Your agent will still get Sitelore notes, but will not submit any.");
      return;
    case "on":
      saveConfig({ contribute: true });
      console.log("Contribution is on. Submissions use your own GitHub account and are public under your name; without local credentials they are skipped.");
      return;
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
