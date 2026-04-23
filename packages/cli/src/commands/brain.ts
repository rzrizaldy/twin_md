import os from "node:os";
import path from "node:path";
import {
  initBrain,
  scanBrainCached,
  rebuildBrainCache,
  gitStatus,
  gitPulse,
  gitHead
} from "@twin-md/brain";
import {
  readTwinConfigOrDefault,
  writeTwinConfig
} from "@twin-md/core/server";

function resolveBrainPath(opts: { path?: string; from?: string }, configBrainPath?: string): string {
  if (opts.path) return path.resolve(opts.path);
  if (opts.from) return path.resolve(opts.from);
  if (configBrainPath) return configBrainPath;
  return path.join(os.homedir(), "twin-brain");
}

export async function runBrainInitCommand(opts: {
  path?: string;
  from?: string;
  noGit?: boolean;
}): Promise<void> {
  const config = await readTwinConfigOrDefault();
  const brainPath = resolveBrainPath(opts, config.brainPath);

  console.log(`Initialising brain vault at ${brainPath}…`);
  const result = await initBrain({
    brainPath,
    noGit: opts.noGit,
    skipExisting: !!opts.from
  });

  if (result.created) {
    console.log(`Created ${brainPath}`);
  } else {
    console.log(`Brain vault already exists at ${brainPath}`);
  }

  if (result.files.length > 0) {
    console.log(`Seeded: ${result.files.join(", ")}`);
  }

  // Persist brainPath to config
  if (config.brainPath !== brainPath) {
    await writeTwinConfig({ ...config, brainPath });
    console.log(`Set brainPath = ${brainPath} in twin.config.json`);
  }

  console.log("Done. Run `twin-md brain sync` to build the initial cache.");
}

export async function runBrainSyncCommand(): Promise<void> {
  const config = await readTwinConfigOrDefault();
  const brainPath = config.brainPath ?? path.join(os.homedir(), "twin-brain");

  console.log(`Syncing brain cache for ${brainPath}…`);
  const entries = await rebuildBrainCache(brainPath);
  console.log(`Cache rebuilt — ${entries.length} note(s) indexed.`);
}

export async function runBrainStatusCommand(): Promise<void> {
  const config = await readTwinConfigOrDefault();
  const brainPath = config.brainPath ?? path.join(os.homedir(), "twin-brain");

  const head = await gitHead(brainPath).catch(() => null);
  const status = await gitStatus(brainPath).catch(() => "(git not available)");
  const entries = await scanBrainCached(brainPath).catch(() => []);

  console.log(`Brain path : ${brainPath}`);
  console.log(`Git HEAD   : ${head ?? "(no commits)"}`);
  console.log(`Notes      : ${entries.length}`);
  console.log(`Git status :`);
  if (status.trim()) {
    for (const line of status.split("\n")) console.log(`  ${line}`);
  } else {
    console.log("  (clean)");
  }
}

export async function runBrainRemoteAddCommand(url: string): Promise<void> {
  const { gitRemoteAdd, gitRemoteUrl } = await import("@twin-md/brain");
  const config = await readTwinConfigOrDefault();
  const brainPath = config.brainPath ?? path.join(os.homedir(), "twin-brain");

  await gitRemoteAdd(brainPath, url);
  const set = await gitRemoteUrl(brainPath);
  console.log(`Remote origin set to: ${set}`);
  console.log("Use your system git credentials to push: git -C " + brainPath + " push -u origin main");
}

export async function runPulseCommand(opts: { limit?: number }): Promise<void> {
  const config = await readTwinConfigOrDefault();
  const brainPath = config.brainPath ?? path.join(os.homedir(), "twin-brain");

  const days = await gitPulse(brainPath, opts.limit ?? 50);
  if (days.length === 0) {
    console.log("No commits yet in the brain vault.");
    return;
  }

  for (const day of days) {
    console.log(`\n${day.date}`);
    for (const e of day.entries) {
      console.log(`  ${e.sha}  ${e.subject}`);
      for (const f of e.files) console.log(`    · ${f}`);
    }
  }
}

export async function runDoctorCommand(): Promise<void> {
  const config = await readTwinConfigOrDefault();
  const brainPath = config.brainPath ?? path.join(os.homedir(), "twin-brain");
  const { existsSync } = await import("node:fs");

  const checks: Array<{ label: string; ok: boolean; fix?: string }> = [];

  checks.push({
    label: "~/.claude/ directory exists",
    ok: existsSync(path.join(os.homedir(), ".claude")),
    fix: "mkdir ~/.claude"
  });

  const twinConfig = path.join(os.homedir(), ".claude", "twin.config.json");
  checks.push({
    label: "twin.config.json exists",
    ok: existsSync(twinConfig),
    fix: "twin-md init"
  });

  const twinMd = path.join(os.homedir(), ".claude", "twin.md");
  checks.push({
    label: "twin.md exists",
    ok: existsSync(twinMd),
    fix: "twin-md harvest"
  });

  checks.push({
    label: "brain vault exists",
    ok: existsSync(brainPath),
    fix: `twin-md brain init --path ${brainPath}`
  });

  if (existsSync(brainPath)) {
    checks.push({
      label: "brain vault is a git repo",
      ok: existsSync(path.join(brainPath, ".git")),
      fix: `git init ${brainPath}`
    });
    const head = await gitHead(brainPath).catch(() => null);
    checks.push({
      label: "brain vault has commits",
      ok: head !== null,
      fix: `twin-md brain sync`
    });
  }

  let allOk = true;
  for (const c of checks) {
    const icon = c.ok ? "✓" : "✗";
    console.log(`${icon}  ${c.label}`);
    if (!c.ok) {
      console.log(`   fix: ${c.fix}`);
      allOk = false;
    }
  }

  if (allOk) {
    console.log("\nAll checks passed.");
  } else {
    console.log("\nSome checks failed — run the suggested fixes above.");
    process.exitCode = 1;
  }
}
