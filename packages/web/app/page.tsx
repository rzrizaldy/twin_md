import {
  interpretTwinDocument,
  readCurrentTwinDocument,
  readCurrentTwinState,
  readTwinConfigOrDefault,
  writePetState
} from "@twin/core";
import { TwinPhoneShell } from "./components/TwinPhoneShell";

async function loadTwinPayload() {
  const config = await readTwinConfigOrDefault();
  const document = await readCurrentTwinDocument(config);
  const state =
    (await readCurrentTwinState()) ??
    (await interpretTwinDocument(document, config));
  await writePetState(state);

  return { document, state };
}

export default async function HomePage() {
  const { document, state } = await loadTwinPayload();

  return <TwinPhoneShell initialDocument={document} initialState={state} />;
}
