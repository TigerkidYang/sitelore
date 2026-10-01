import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type Channel = "auto" | "github" | "intake";

export interface Config {
  /** Automatic contribution. On by default; `sitelore off` turns it off. */
  contribute: boolean;
  /** Whether the first-run notice has been shown to the user. */
  noticeShown: boolean;
  /** Data repo, "owner/name". Empty until configured. */
  dataRepo: string;
  /** Where bundles/<host>.json and bundles/hosts.json are served from: an https URL or a local directory. */
  bundleSource: string;
  /** Intake service base URL, the default submission channel. Empty until configured. */
  intakeUrl: string;
  /**
   * Which submission channel to use. "intake" (default) sends to the Sitelore intake service.
   * "auto" is opt-in (`sitelore github on`): PRs are opened from the user's own GitHub account
   * (their name becomes public on the PR), falling back to the intake service. "github" never falls back.
   */
  channel: Channel;
  /** Record submissions to a local file instead of uploading them (for testing). */
  recordOnly: boolean;
}

/**
 * Development build: there is no official data repo or intake service yet, so
 * nothing is assumed. Without configuration, lookups report that Sitelore is not
 * configured and the submission tools are not offered; nothing is fetched from or sent to a namespace
 * or domain this project does not control. (The `sitelore` GitHub org belongs to
 * an unrelated project.)
 */
export function bundleSourceFor(dataRepo: string): string {
  return dataRepo ? `https://raw.githubusercontent.com/${dataRepo}/bundles/` : "";
}

export function defaults(dataRepo = ""): Config {
  return {
    contribute: true,
    noticeShown: false,
    dataRepo,
    bundleSource: bundleSourceFor(dataRepo),
    intakeUrl: "",
    channel: "intake",
    recordOnly: false,
  };
}

export function homeDir(): string {
  return process.env.SITELORE_HOME || join(homedir(), ".sitelore");
}

function configPath(): string {
  return join(homeDir(), "config.json");
}

/** Reads config.json, then applies SITELORE_* environment overrides (which are never persisted). */
export function loadConfig(): { config: Config; firstRun: boolean } {
  let stored: Partial<Config> = {};
  let firstRun = false;
  try {
    stored = JSON.parse(readFileSync(configPath(), "utf8")) as Partial<Config>;
  } catch {
    firstRun = true;
  }
  const config = { ...defaults(stored.dataRepo), ...stored };
  applyEnv(config);
  return { config, firstRun };
}

function applyEnv(c: Config): void {
  const env = process.env;
  if (env.SITELORE_DATA_REPO) {
    c.dataRepo = env.SITELORE_DATA_REPO;
    c.bundleSource = bundleSourceFor(c.dataRepo);
  }
  if (env.SITELORE_BUNDLES) c.bundleSource = env.SITELORE_BUNDLES;
  if (env.SITELORE_INTAKE_URL) c.intakeUrl = env.SITELORE_INTAKE_URL;
  if (env.SITELORE_CHANNEL) c.channel = env.SITELORE_CHANNEL as Channel;
  if (env.SITELORE_RECORD_ONLY) c.recordOnly = env.SITELORE_RECORD_ONLY !== "0";
  if (env.SITELORE_CONTRIBUTE) c.contribute = env.SITELORE_CONTRIBUTE !== "0";
}

/** Persists only the given keys, so env overrides are not written to disk. */
export function saveConfig(patch: Partial<Config>): void {
  let stored: Partial<Config> = {};
  try {
    stored = JSON.parse(readFileSync(configPath(), "utf8")) as Partial<Config>;
  } catch {
    // first write
  }
  mkdirSync(homeDir(), { recursive: true });
  writeFileSync(configPath(), JSON.stringify({ ...stored, ...patch }, null, 2) + "\n");
}
