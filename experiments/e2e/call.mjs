// Calls one tool on the built sitelore MCP server over stdio, with the real environment.
//   node call.mjs <tool> '<json args>'
// Configure with SITELORE_* env vars (SITELORE_DATA_REPO, SITELORE_CHANNEL, SITELORE_INTAKE_URL, SITELORE_HOME...).
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = dirname(fileURLToPath(import.meta.url));
const [tool, json] = process.argv.slice(2);
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve(here, "../../packages/client/dist/cli.js")],
  env: process.env,
  stderr: "inherit",
});
const client = new Client({ name: "e2e", version: "0" });
await client.connect(transport);
try {
  const r = await client.callTool({ name: tool, arguments: JSON.parse(json ?? "{}") });
  console.log(r.isError ? "[isError]" : "[ok]");
  for (const c of r.content) console.log(c.text);
} finally {
  await client.close();
}
