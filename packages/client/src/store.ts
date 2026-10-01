import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HostBundle, HostIndex } from "@sitelore/core";
import { homeDir } from "./config.js";

const TTL_MS = 60 * 60 * 1000;

/**
 * Reads published bundles, from an https base URL (with a one-hour disk cache)
 * or directly from a local directory (for testing and offline use).
 */
export class BundleStore {
  constructor(
    private readonly source: string,
    private readonly fetchImpl: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  private get isRemote(): boolean {
    return /^https?:\/\//.test(this.source);
  }

  async hosts(): Promise<Set<string>> {
    const index = await this.read<HostIndex>("hosts.json");
    return new Set(index?.hosts ?? []);
  }

  async bundle(host: string): Promise<HostBundle | null> {
    return this.read<HostBundle>(`${host}.json`);
  }

  private async read<T>(name: string): Promise<T | null> {
    if (!this.isRemote) {
      try {
        return JSON.parse(readFileSync(join(this.source, name), "utf8")) as T;
      } catch {
        return null;
      }
    }

    const cacheDir = join(homeDir(), "cache");
    const cacheFile = join(cacheDir, name);
    const cached = readCache<T>(cacheFile);
    if (cached && Date.now() - cached.at < TTL_MS) return cached.data;

    try {
      const url = new URL(name, this.source.endsWith("/") ? this.source : this.source + "/");
      const res = await this.fetchImpl(url, { headers: { "user-agent": "sitelore" } });
      if (res.status === 404) {
        writeCache(cacheDir, cacheFile, null);
        return null;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as T;
      writeCache(cacheDir, cacheFile, data);
      return data;
    } catch (err) {
      // Network trouble: serve stale cache rather than nothing.
      if (cached) return cached.data;
      throw err;
    }
  }
}

function readCache<T>(file: string): { at: number; data: T | null } | null {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as { at: number; data: T | null };
  } catch {
    return null;
  }
}

function writeCache(dir: string, file: string, data: unknown): void {
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify({ at: Date.now(), data }));
  } catch {
    // cache is best effort
  }
}
