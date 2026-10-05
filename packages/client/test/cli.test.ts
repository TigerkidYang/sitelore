import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";

const cli = resolve(__dirname, "../dist/cli.js");

// Exercises the published bundle end to end over stdio, which catches bundling problems unit tests miss.
describe.skipIf(!existsSync(cli))("built CLI", () => {
  it("exposes the contribution switch and GitHub notice without routing commands", () => {
    const home = mkdtempSync(join(tmpdir(), "sitelore-cli-config-"));
    const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], {
      encoding: "utf8",
      windowsHide: true,
      env: { ...process.env, SITELORE_HOME: home, SITELORE_CONTRIBUTE: "", SITELORE_DATA_REPO: "", SITELORE_BUNDLES: "", SITELORE_RECORD_ONLY: "" },
    });
    expect(run("--help").stdout).toContain("your own GitHub account");
    const removed = run("github", "on");
    expect(removed.status).toBe(1);
    expect(removed.stderr).toContain("Unknown command: github");
    expect(run("off").status).toBe(0);
    expect(JSON.parse(run("status").stdout).contribute).toBe(false);
    expect(run("on").status).toBe(0);
    const init = run("init");
    expect(init.stdout).toContain("Your GitHub username will be publicly associated");
    const status = JSON.parse(run("status").stdout);
    expect(status.contribute).toBe(true);
    expect(status.noticeVersion).toBe("github-mit-v1");
    expect(status).not.toHaveProperty("channel");
    expect(status).not.toHaveProperty("intakeUrl");
  }, 30_000);

  it("serves the MCP protocol over stdio", async () => {
    const home = mkdtempSync(join(tmpdir(), "sitelore-cli-"));
    const bundles = mkdtempSync(join(tmpdir(), "sitelore-bundles-"));
    writeFileSync(join(bundles, "hosts.json"), JSON.stringify({ generatedAt: "", hosts: [] }));

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [cli],
      env: { ...process.env, SITELORE_HOME: home, SITELORE_BUNDLES: bundles, SITELORE_RECORD_ONLY: "1" } as Record<string, string>,
    });
    const client = new Client({ name: "cli-test", version: "0" });
    await client.connect(transport);
    try {
      const tools = (await client.listTools()).tools.map((t) => t.name).sort();
      expect(tools).toEqual(["correct_experience", "get_site_experience", "submit_experience"]);
      const r = (await client.callTool({ name: "get_site_experience", arguments: { url: "https://example.com" } })) as {
        content: { text: string }[];
      };
      expect(r.content[0]!.text).toContain("example.com");
      const s = (await client.callTool({
        name: "submit_experience",
        arguments: { url: "example.com", title: "Search", body: "Press Enter; the search icon ignores the first click." },
      })) as { content: { text: string }[] };
      expect(s.content[0]!.text).toContain("Recorded locally");
    } finally {
      await client.close();
    }
  }, 30_000);
});
