#!/usr/bin/env node
import { resolve } from "node:path";
import { buildBundles, checkEntries, formatProblems, listEntryPaths, takedown } from "./lib.js";

const USAGE = `sitelore-data <command> [--root <data repo>]

  check [paths...]     Check entry files (default: all). Exit 1 on errors.
  build --out <dir>    Write bundles/<host>.json and hosts.json
  takedown <domain>    Delete all entries for a domain and blocklist it
`;

function main(argv: string[]): number {
  const args = [...argv];
  const take = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    if (i < 0) return undefined;
    const [, value] = args.splice(i, 2);
    return value;
  };
  const root = resolve(take("--root") ?? ".");
  const [cmd, ...rest] = args;

  switch (cmd) {
    case "check": {
      const paths = rest.length ? rest : listEntryPaths(root);
      const { problems, entries } = checkEntries(root, paths);
      if (problems.length) console.log(formatProblems(problems));
      const errors = problems.filter((p) => p.level === "error").length;
      console.log(`${entries.length} entries checked, ${errors} errors, ${problems.length - errors} warnings`);
      return errors ? 1 : 0;
    }
    case "build": {
      const out = take("--out") ?? rest[0];
      if (!out) break;
      const r = buildBundles(root, resolve(out));
      if (r.skipped.length) console.log(`skipped invalid entries:\n${formatProblems(r.skipped)}`);
      console.log(`built ${r.hosts} host bundles with ${r.entries} entries`);
      return 0;
    }
    case "takedown": {
      if (!rest[0]) break;
      const removed = takedown(root, rest[0]);
      console.log(`removed ${removed.length ? removed.join(", ") : "no hosts"}; ${rest[0]} is now blocklisted`);
      return 0;
    }
  }
  console.error(USAGE);
  return 2;
}

process.exitCode = main(process.argv.slice(2));
