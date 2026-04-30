import {
  readTwinConfigOrDefault,
  runTwinHarvest
} from "@twin-md/core/server";

export async function runHarvestCommand(): Promise<void> {
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
}
