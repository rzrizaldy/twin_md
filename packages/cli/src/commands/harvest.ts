import { readTwinConfigOrDefault, runTwinHarvest } from "@twin/core";

export async function runHarvestCommand(): Promise<void> {
  const config = await readTwinConfigOrDefault();
  const result = await runTwinHarvest(config);

  console.log(`Harvest complete.`);
  console.log(`twin.md: ${result.twinMdPath}`);
  console.log(`state: ${result.statePath}`);
  console.log(`snapshot: ${result.snapshotPath}`);
  console.log(
    `scene: ${result.state.caption} | state ${result.state.state} | environment ${result.state.environment}`
  );
}
