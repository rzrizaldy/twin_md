import { render } from "ink";
import {
  ensureSeedTwin,
  interpretTwinDocument,
  readTwinConfigOrDefault,
  readCurrentTwinState,
  writePetState
} from "@twin-md/core";
import { TwinWatchApp } from "../ui/TwinWatchApp.js";

export async function runWatchCommand(): Promise<void> {
  const config = await readTwinConfigOrDefault();
  const currentState = await readCurrentTwinState();

  if (!currentState) {
    const document = await ensureSeedTwin(config);
    const state = await interpretTwinDocument(document, config);
    await writePetState(state);
  }

  const app = render(<TwinWatchApp config={config} />);
  await app.waitUntilExit();
}
