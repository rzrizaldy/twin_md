import { NextResponse } from "next/server";
import {
  interpretTwinDocument,
  readCurrentTwinDocument,
  readCurrentTwinState,
  readTwinConfigOrDefault,
  writePetState
} from "@twin/core";

export async function GET() {
  const config = await readTwinConfigOrDefault();
  const document = await readCurrentTwinDocument(config);
  const state =
    (await readCurrentTwinState()) ??
    (await interpretTwinDocument(document, config));

  await writePetState(state);

  return NextResponse.json({
    document,
    state
  });
}
