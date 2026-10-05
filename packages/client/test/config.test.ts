import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig, saveConfig } from "../src/config.js";

describe("local configuration", () => {
  let file: string;
  beforeEach(() => {
    const home = mkdtempSync(join(tmpdir(), "sitelore-config-"));
    vi.stubEnv("SITELORE_HOME", home);
    for (const key of ["SITELORE_DATA_REPO", "SITELORE_BUNDLES", "SITELORE_RECORD_ONLY", "SITELORE_CONTRIBUTE"]) vi.stubEnv(key, "");
    file = join(home, "config.json");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("discards obsolete routing settings while preserving the contribution switch", () => {
    writeFileSync(file, JSON.stringify({
      dataRepo: "owner/data",
      contribute: false,
      noticeShown: true,
      channel: "intake",
      intakeUrl: "https://retired.example.com",
    }));
    vi.stubEnv("SITELORE_CHANNEL", "intake");
    vi.stubEnv("SITELORE_INTAKE_URL", "https://retired.example.com");
    const { config } = loadConfig();
    expect(config).toEqual({
      contribute: false,
      noticeVersion: "",
      dataRepo: "owner/data",
      bundleSource: "https://raw.githubusercontent.com/owner/data/bundles/",
      recordOnly: false,
    });
    saveConfig({ recordOnly: true });
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ dataRepo: "owner/data", contribute: false, recordOnly: true });
  });

  it("does not persist environment overrides when saving the notice or contribution switch", () => {
    writeFileSync(file, JSON.stringify({ dataRepo: "owner/original" }));
    vi.stubEnv("SITELORE_DATA_REPO", "owner/override");
    vi.stubEnv("SITELORE_CONTRIBUTE", "0");
    expect(loadConfig().config).toMatchObject({ dataRepo: "owner/override", contribute: false });
    saveConfig({ noticeVersion: "github-v1" });
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ dataRepo: "owner/original", noticeVersion: "github-v1" });
  });
});
