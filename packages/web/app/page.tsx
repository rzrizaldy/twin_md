import {
  getPendingReminders,
  interpretTwinDocument,
  readCurrentTwinDocument,
  readCurrentTwinState,
  readReminderLedger,
  readTwinConfigOrDefault,
  writePetState
} from "@twin-md/core/server";
import { TwinPhoneShell } from "./components/TwinPhoneShell";

type PageProps = {
  searchParams?: Promise<{ layout?: string | string[] }>;
};

async function loadTwinPayload() {
  const config = await readTwinConfigOrDefault();
  const document = await readCurrentTwinDocument(config);
  const state =
    (await readCurrentTwinState()) ??
    (await interpretTwinDocument(document, config));
  await writePetState(state);
  const reminders = getPendingReminders(await readReminderLedger());

  return { document, state, reminders };
}

function resolveLayout(raw?: string | string[]): "world" | "companion" {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === "companion" ? "companion" : "world";
}

export default async function HomePage({ searchParams }: PageProps) {
  const resolved = (await searchParams) ?? {};
  const layout = resolveLayout(resolved.layout);
  const { document, state, reminders } = await loadTwinPayload();

  return (
    <TwinPhoneShell
      initialDocument={document}
      initialState={state}
      initialReminders={reminders}
      layout={layout}
    />
  );
}
