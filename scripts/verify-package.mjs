import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const temp = mkdtempSync(join(tmpdir(), "sitelore-package-"));
const npmCli = process.env.npm_execpath;
assert(npmCli, "Run through npm run test:package");
const npmEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^npm_/i.test(key) && key !== "INIT_CWD"));
const npm = (args, cwd = root) => execFileSync(process.execPath, [npmCli, "--prefix", cwd, ...args], {
  cwd, env: npmEnv, encoding: "utf8", windowsHide: true, timeout: 120_000,
});
const [packed] = JSON.parse(npm(["pack", "--workspace", "packages/client", "--pack-destination", temp, "--json"]));
const paths = packed.files.map((file) => file.path);
for (const required of ["dist/cli.js", "LICENSE", "README.md", "THIRD_PARTY_NOTICES.txt", "skill/sitelore/SKILL.md"]) {
  assert(paths.includes(required), `Missing packaged file: ${required}`);
}
assert(paths.every((path) => /^(dist\/|skill\/|package\.json$|LICENSE$|README\.md$|THIRD_PARTY_NOTICES\.txt$)/.test(path)), "Unexpected package contents");

console.log(`Installing ${packed.filename} outside the monorepo...`);
writeFileSync(join(temp, "package.json"), JSON.stringify({ name: "sitelore-release-smoke", private: true }));
npm(["install", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false", join(temp, packed.filename)], temp);
const installed = join(temp, "node_modules", "sitelore");
const cli = join(installed, "dist", "cli.js");
const manifest = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"));
assert.equal(manifest.license, "MIT");
assert.equal(manifest.bin.sitelore, "dist/cli.js");
assert.equal(npm(["exec", "--offline", "--", "sitelore", "--version"], temp).trim(), manifest.version);

const env = { ...process.env, SITELORE_HOME: join(temp, "state") };
for (const key of ["SITELORE_DATA_REPO", "SITELORE_BUNDLES", "SITELORE_RECORD_ONLY", "SITELORE_CONTRIBUTE", "SITELORE_EVENT_LOG", "GITHUB_TOKEN", "GH_TOKEN"]) delete env[key];
const status = JSON.parse(execFileSync(process.execPath, [cli, "status"], { env, encoding: "utf8", windowsHide: true }));
assert.equal(status.dataRepo, "TigerkidYang/sitelore-data");
assert.equal(status.bundleSource, "https://raw.githubusercontent.com/TigerkidYang/sitelore-data/bundles/");

// Exercise the installed server without ever uploading a fixture.
const bundles = join(temp, "bundles");
mkdirSync(bundles);
writeFileSync(join(bundles, "hosts.json"), JSON.stringify({ generatedAt: "", hosts: [] }));
const client = new Client({ name: "package-smoke", version: "1" });
const transport = new StdioClientTransport({
  command: process.execPath, args: [cli],
  env: { ...env, SITELORE_BUNDLES: bundles, SITELORE_RECORD_ONLY: "1" },
});
await client.connect(transport);
try {
  assert.deepEqual((await client.listTools()).tools.map((tool) => tool.name).sort(), ["correct_experience", "get_site_experience", "submit_experience"]);
  const lookup = await client.callTool({ name: "get_site_experience", arguments: { url: "example.com" } });
  assert(!lookup.isError);
  assert(lookup.content.some((item) => item.text?.includes("example.com")));
  const submission = await client.callTool({ name: "submit_experience", arguments: {
    url: "example.com", title: "Package smoke test", body: "Synthetic local-only fixture for package verification.",
  } });
  assert(!submission.isError);
  assert(submission.content.some((item) => item.text?.includes("Recorded locally")));
} finally {
  await client.close();
}
console.log(`Package verified: ${join(temp, packed.filename)}\nIntegrity: ${packed.integrity}`);
