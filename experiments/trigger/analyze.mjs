// Summarizes a batch produced by run.mjs: node analyze.mjs <batch dir>
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const batch = process.argv[2];
if (!batch) throw new Error("usage: node analyze.mjs <batch dir>");

const rows = [];
for (const name of readdirSync(batch)) {
  const dir = join(batch, name);
  if (!existsSync(join(dir, "meta.json"))) continue;
  const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8"));
  const lines = existsSync(join(dir, "stream.jsonl")) ? readFileSync(join(dir, "stream.jsonl"), "utf8").split("\n").filter(Boolean) : [];
  const tools = [];
  let result = null;
  for (const line of lines) {
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (ev.type === "assistant") {
      for (const c of ev.message?.content ?? []) if (c.type === "tool_use") tools.push({ name: c.name, input: c.input });
    }
    if (ev.type === "result") result = ev;
  }
  const idx = (pred) => tools.findIndex(pred);
  const firstBrowser = idx((t) => t.name.startsWith("mcp__playwright__"));
  const firstQuery = idx((t) => t.name === "mcp__sitelore__get_site_experience");
  const submits = tools.filter((t) => t.name === "mcp__sitelore__submit_experience");
  const corrections = tools.filter((t) => t.name === "mcp__sitelore__correct_experience");
  rows.push({
    run: name,
    ...meta,
    browserCalls: tools.filter((t) => t.name.startsWith("mcp__playwright__")).length,
    queried: firstQuery >= 0,
    queriedFirst: firstQuery >= 0 && (firstBrowser < 0 || firstQuery < firstBrowser),
    queries: tools.filter((t) => t.name === "mcp__sitelore__get_site_experience").map((t) => t.input?.url),
    skillUsed: tools.some((t) => t.name === "Skill"),
    submits: submits.map((t) => t.input),
    corrections: corrections.length,
    ok: result ? !result.is_error : false,
    turns: result?.num_turns,
    cost: result?.total_cost_usd,
    seconds: result ? Math.round(result.duration_ms / 1000) : null,
    answer: result?.result?.slice(0, 300),
  });
}

const groups = new Map();
for (const r of rows) {
  const key = `${r.model} ${r.variant}`;
  groups.set(key, [...(groups.get(key) ?? []), r]);
}
const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : "-");
const table = [
  "| model variant | runs | exited ok (not task success) | queried before 1st browser action | queried at all | runs with ≥1 submit | submits | avg cost $ |",
  "| --- | --- | --- | --- | --- | --- | --- | --- |",
];
for (const [key, rs] of [...groups].sort()) {
  const n = rs.length;
  const cost = rs.reduce((s, r) => s + (r.cost ?? 0), 0) / n;
  table.push(
    `| ${key} | ${n} | ${pct(rs.filter((r) => r.ok).length, n)} | ${pct(rs.filter((r) => r.queriedFirst).length, n)} | ${pct(rs.filter((r) => r.queried).length, n)} | ${pct(rs.filter((r) => r.submits.length).length, n)} | ${rs.reduce((s, r) => s + r.submits.length, 0)} | ${cost.toFixed(2)} |`,
  );
}

const perRun = ["| run | exited ok | browser calls | queried first | submits | s |", "| --- | --- | --- | --- | --- | --- |"];
for (const r of rows.sort((a, b) => a.run.localeCompare(b.run))) {
  perRun.push(`| ${r.run} | ${r.ok ? "✓" : "✗"} | ${r.browserCalls} | ${r.queriedFirst ? "✓" : r.queried ? "late" : "✗"} | ${r.submits.length} | ${r.seconds ?? "-"} |`);
}

const subs = [];
for (const r of rows) for (const s of r.submits) subs.push(`### ${r.run}\n\n**${s.title}** (${s.url})${s.applies_when ? `\n\n_applies when:_ ${s.applies_when}` : ""}\n\n${s.body}\n`);

const report = `# Trigger experiment: ${batch}\n\n${table.join("\n")}\n\n## Runs\n\n${perRun.join("\n")}\n\n## Submissions\n\n${subs.join("\n") || "(none)"}\n`;
writeFileSync(join(batch, "report.md"), report);
writeFileSync(join(batch, "summary.json"), JSON.stringify(rows, null, 2));
console.log(report);
