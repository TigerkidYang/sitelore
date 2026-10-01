import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  platform: "node",
  target: "node20",
  // Bundle the shared core (and its small deps) so the published package is self-contained.
  noExternal: ["@sitelore/core", "tldts", "tldts-core", "yaml"],
  // yaml is CommonJS; give its bundled require() calls a real require in ESM.
  banner: {
    js: [
      "#!/usr/bin/env node",
      'import { createRequire as __slCreateRequire } from "node:module";',
      "const require = __slCreateRequire(import.meta.url);",
    ].join("\n"),
  },
  clean: true,
});
