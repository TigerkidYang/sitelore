import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Config {
  /** Automatic contribution. On by default; `sitelore off` turns it off. */
  contribute: boolean;
  /** Version of the contribution notice already shown to the user. */
  noticeVersion: string;
  /** Data repo, "owner/name". Defaults to the official community repository. */
  dataRepo: string;
  /** Where bundles/<host>.json and bundles/hosts.json are served from: an https URL or a local directory. */
  bundleSource: string;
  /** Record submissions to a local file instead of uploading them (for testing). */
  recordOnly: boolean;
}

export const DEFAULT_DATA_REPO = "TigerkidYang/sitelore-data";

/** Submissions use only the user's local GitHub credentials. */
export function bundleSourceFor(dataRepo: string): string {
  return dataRepo ? `https://raw.githubusercontent.com/${dataRepo}/bundles/` : "";
}

export function defaults(dataRepo = DEFAULT_DATA_REPO): Config {
  return {
    contribute: true,
    noticeVersion: "",
    dataRepo,
    bundleSource: bundleSourceFor(dataRepo),
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
  const stored = readStoredConfig();
  const config = { ...defaults(stored?.dataRepo), ...stored };
  applyEnv(config);
  return { config, firstRun: stored === null };
}

/** Read only supported settings; removed settings are neither used nor saved again. */
function readStoredConfig(): Partial<Config> | null {
  try {
    const raw: unknown = JSON.parse(readFileSync(configPath(), "utf8"));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const values = raw as Record<string, unknown>;
    const stored: Partial<Config> = {};
    for (const key of ["contribute", "recordOnly"] as const) {
      if (typeof values[key] === "boolean") stored[key] = values[key];
    }
    for (const key of ["dataRepo", "bundleSource", "noticeVersion"] as const) {
      if (typeof values[key] === "string") stored[key] = values[key];
    }
    return stored;
  } catch {
    return null;
  }
}

function applyEnv(c: Config): void {
  const env = process.env;
  if (env.SITELORE_DATA_REPO) {
    c.dataRepo = env.SITELORE_DATA_REPO;
    c.bundleSource = bundleSourceFor(c.dataRepo);
  }
  if (env.SITELORE_BUNDLES) c.bundleSource = env.SITELORE_BUNDLES;
  if (env.SITELORE_RECORD_ONLY) c.recordOnly = env.SITELORE_RECORD_ONLY !== "0";
  if (env.SITELORE_CONTRIBUTE) c.contribute = env.SITELORE_CONTRIBUTE !== "0";
}

/** Persists only the given keys, so env overrides are not written to disk. */
export function saveConfig(patch: Partial<Config>): void {
  const stored = readStoredConfig();
  mkdirSync(homeDir(), { recursive: true });
  writeFileSync(configPath(), JSON.stringify({ ...stored, ...patch }, null, 2) + "\n");
}
