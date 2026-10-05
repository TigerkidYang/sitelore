// Trigger experiment runner: does the agent query Sitelore before operating a
// site, and submit pitfalls afterward, under different integration styles?
//
//   A  MCP server instructions + tool descriptions only
//   B  A + the Sitelore skill
//   C  A + Claude Code hooks (PreToolUse reminder on navigate, one-time Stop nudge)
//
// Setup: cd experiments/trigger && npm ci   (needs the Claude Code CLI and Chrome)
// Usage: node run.mjs [--models sonnet,opus] [--variants A,B,C] [--tasks id,id] [--reps 1] [--concurrency 4]
import { spawn } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, writeFileSync, createWriteStream } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};

const models = arg("models", "sonnet").split(",");
const variants = arg("variants", "A,B,C").split(",");
const allTasks = JSON.parse(readFileSync(join(here, "tasks.json"), "utf8"));
const taskIds = arg("tasks", allTasks.map((t) => t.id).join(",")).split(",");
const tasks = allTasks.filter((t) => taskIds.includes(t.id));
const reps = Number(arg("reps", "1"));
const concurrency = Number(arg("concurrency", "4"));
const timeoutMs = Number(arg("timeout", String(12 * 60_000)));

const batch = join(here, "runs", new Date().toISOString().replace(/[:.]/g, "-"));
// --bundles <dir> serves an existing bundle directory instead of an empty library.
const emptyBundles = arg("bundles") ? resolve(arg("bundles")) : join(batch, "bundles");
mkdirSync(emptyBundles, { recursive: true });
if (!arg("bundles")) writeFileSync(join(emptyBundles, "hosts.json"), JSON.stringify({ generatedAt: new Date().toISOString(), hosts: [] }));

const sitelore = join(repoRoot, "packages/client/dist/cli.js");
const playwright = join(here, "node_modules/@playwright/mcp/cli.js");
const hooks = join(here, "hooks.mjs");

function prepare(model, variant, task, rep) {
  const dir = join(batch, `${model}-${variant}-${task.id}-${rep}`);
  const work = join(dir, "work");
  mkdirSync(join(work, ".claude"), { recursive: true });
  const home = join(dir, "sitelore-home");
  mkdirSync(home, { recursive: true });

  // Passed with --settings: project settings are ignored in an untrusted workspace.
  const settings = { permissions: { allow: ["mcp__playwright", "mcp__sitelore", "Skill"] } };
  if (variant === "B") {
    cpSync(join(repoRoot, "packages/client/skill/sitelore"), join(work, ".claude/skills/sitelore"), { recursive: true });
  }
  if (variant === "C") {
    settings.hooks = {
      PreToolUse: [{ matcher: "mcp__playwright__browser_navigate", hooks: [{ type: "command", command: `node "${hooks}" pre` }] }],
      Stop: [{ hooks: [{ type: "command", command: `node "${hooks}" stop` }] }],
    };
  }
  writeFileSync(join(dir, "settings.json"), JSON.stringify(settings, null, 2));

  const mcp = {
    mcpServers: {
      playwright: {
        command: "node",
        args: [playwright, "--headless", "--isolated", "--output-dir", join(dir, "playwright")],
      },
      sitelore: {
        command: "node",
        args: [sitelore],
        env: {
          SITELORE_HOME: home,
          SITELORE_RECORD_ONLY: "1",
          SITELORE_BUNDLES: emptyBundles,
          SITELORE_EVENT_LOG: join(dir, "events.jsonl"),
        },
      },
    },
  };
  writeFileSync(join(dir, "mcp.json"), JSON.stringify(mcp, null, 2));
  return { dir, work };
}

function runOne(model, variant, task, rep) {
  const { dir, work } = prepare(model, variant, task, rep);
  const args = [
    "-p",
    task.prompt,
    "--model",
    model,
    "--output-format",
    "stream-json",
    "--verbose",
    "--mcp-config",
    join(dir, "mcp.json"),
    "--strict-mcp-config",
    "--setting-sources",
    "project",
    "--settings",
    join(dir, "settings.json"),
    "--allowedTools",
    "mcp__playwright",
    "mcp__sitelore",
    "Skill",
    "--tools",
    "Skill",
  ];
  writeFileSync(join(dir, "meta.json"), JSON.stringify({ model, variant, task: task.id, rep, prompt: task.prompt }, null, 2));
  return new Promise((done) => {
    const started = Date.now();
    const out = createWriteStream(join(dir, "stream.jsonl"));
    const child = spawn("claude", args, { cwd: work, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    child.stdout.pipe(out);
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      writeFileSync(join(dir, "exit.json"), JSON.stringify({ code, ms: Date.now() - started, stderr: stderr.slice(-4000) }, null, 2));
      console.log(`done ${model}-${variant}-${task.id}-${rep} code=${code} ${Math.round((Date.now() - started) / 1000)}s`);
      done();
    });
  });
}

const queue = [];
for (let rep = 1; rep <= reps; rep++)
  for (const task of tasks) for (const model of models) for (const variant of variants) queue.push([model, variant, task, rep]);

console.log(`${queue.length} runs -> ${batch}`);
await Promise.all(
  Array.from({ length: concurrency }, async () => {
    while (queue.length) await runOne(...queue.shift());
  }),
);
console.log(`all done: node analyze.mjs "${batch}"`);
