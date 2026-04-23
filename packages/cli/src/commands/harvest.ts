import chokidar from "chokidar";
import {
  expandHome,
  readTwinConfigOrDefault,
  runTwinHarvest
} from "@twin-md/core/server";

export async function runHarvestCommand(options: {
  watch?: boolean;
} = {}): Promise<void> {
  const config = await readTwinConfigOrDefault();

  const logResult = (label: string, result: Awaited<ReturnType<typeof runTwinHarvest>>) => {
    console.log(`${label}Harvest complete.`);
    console.log(`twin.md: ${result.twinMdPath}`);
    console.log(`state: ${result.statePath}`);
    console.log(`snapshot: ${result.snapshotPath}`);
    console.log(
      `scene: ${result.state.caption} | state ${result.state.state} | environment ${result.state.environment}`
    );
  };

  const result = await runTwinHarvest(config);
  logResult("", result);

  if (!options.watch) {
    return;
  }

  const roots = [
    expandHome(config.claudeDir),
    expandHome(config.healthPath),
    expandHome(config.calendarPath),
    expandHome(config.locationPath),
    config.obsidianVaultPath ? expandHome(config.obsidianVaultPath) : null
  ].filter((p): p is string => Boolean(p));

  let debounce: NodeJS.Timeout | undefined;
  const schedule = () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      runTwinHarvest(config)
        .then((r) => {
          const stamp = new Date().toISOString();
          console.log(`\n[watch ${stamp}]`);
          logResult("", r);
        })
        .catch((err) => {
          console.error("[watch] harvest failed:", err instanceof Error ? err.message : err);
        });
    }, 1400);
  };

  const watcher = chokidar.watch(roots, {
    ignoreInitial: true,
    depth: 14,
    ignored: (p: string) =>
      /node_modules|\.git|\.next|\/dist\/|Library\/Application Support\/Code|\/\.npm\//u.test(
        p
      )
  });

  watcher.on("all", schedule);
  console.log(
    "\nWatching for file changes (Claude dir, vault, exports). Ctrl+C to stop."
  );

  await new Promise<void>((resolve) => {
    const stop = () => {
      void watcher.close().then(() => resolve());
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}
