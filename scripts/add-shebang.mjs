import { chmodSync, readFileSync, writeFileSync } from "node:fs";

const target = process.argv[2];

if (!target) {
  throw new Error("Expected a target file path.");
}

const source = readFileSync(target, "utf8");
const shebang = "#!/usr/bin/env node\n";
const next = source.startsWith(shebang) ? source : `${shebang}${source}`;

writeFileSync(target, next, "utf8");
chmodSync(target, 0o755);
