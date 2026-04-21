import { NextResponse } from "next/server";
import {
  interpretTwinDocument,
  readCurrentTwinDocument,
  readCurrentTwinState,
  readTwinConfigOrDefault,
  speakWithTwin,
  writePetState
} from "@twin-md/core";

export async function POST(request: Request) {
  const body = (await request.json()) as { prompt?: string };
  const prompt = body.prompt?.trim();

  if (!prompt) {
    return NextResponse.json({ error: "prompt is required" }, { status: 400 });
  }

  const config = await readTwinConfigOrDefault();
  const document = await readCurrentTwinDocument(config);
  const state =
    (await readCurrentTwinState()) ??
    (await interpretTwinDocument(document, config));
  await writePetState(state);

  const reply = await speakWithTwin(document, state, prompt, config);

  return NextResponse.json({
    reply,
    state
  });
}
