import { readFileSync, writeFileSync } from "node:fs";

// These dependencies are embedded in the CLI rather than installed separately.
const notices = ["Third-party licenses for dependencies bundled into the Sitelore CLI.\n"];
for (const name of ["tldts", "tldts-core", "yaml"]) {
  const dir = new URL(`../node_modules/${name}/`, import.meta.url);
  const { version } = JSON.parse(readFileSync(new URL("package.json", dir), "utf8"));
  notices.push(`${name} ${version}\n${"=".repeat(60)}\n${readFileSync(new URL("LICENSE", dir), "utf8")}`);
}
writeFileSync(new URL("../packages/client/THIRD_PARTY_NOTICES.txt", import.meta.url), notices.join("\n\n"));
