// Re-screens recorded submissions of a batch with the current scrub/danger rules: node screen.mjs <batch dir>
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkDanger, normalizeHost, scrub } from "../../packages/core/dist/index.js";

const batch = process.argv[2];
let n = 0;
for (const run of readdirSync(batch)) {
  const dir = join(batch, run, "sitelore-home", "records");
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir)) {
    n++;
    const r = JSON.parse(readFileSync(join(dir, f), "utf8"));
    const s = r.submission;
    const text = [s.title, s.appliesWhen, s.body].filter(Boolean).join("\n");
    if (r.scrubbed.length) console.log(`scrubbed at submit  ${run}: ${r.scrubbed.join(", ")}`);
    const again = scrub(text);
    if (again.replaced.length) console.log(`would scrub now     ${run}: ${again.replaced.join(", ")}`);
    const d = checkDanger(text, normalizeHost(s.site));
    if (d.hits.length) console.log(`danger hits         ${run}: ${JSON.stringify(d.hits)}`);
    if (s.body.length > 1000) console.log(`long body           ${run}: ${s.body.length} chars`);
  }
}
console.log(`${n} records screened`);
