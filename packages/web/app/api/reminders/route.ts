import { NextResponse } from "next/server";
import {
  acknowledgeReminder,
  dismissReminder,
  getPendingReminders,
  interpretTwinDocument,
  readCurrentTwinDocument,
  readCurrentTwinState,
  readReminderLedger,
  readTwinConfigOrDefault,
  runReminderSweep,
  writePetState
} from "@twin-md/core";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const shouldSweep = url.searchParams.get("sweep") === "1";

  if (shouldSweep) {
    const config = await readTwinConfigOrDefault();
    const document = await readCurrentTwinDocument(config);
    const state =
      (await readCurrentTwinState()) ??
      (await interpretTwinDocument(document, config));
    await writePetState(state);
    const { all } = await runReminderSweep(document, state);
    return NextResponse.json({ reminders: getPendingReminders(all) });
  }

  const ledger = await readReminderLedger();
  return NextResponse.json({ reminders: getPendingReminders(ledger) });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    id?: string;
    action?: "acknowledge" | "dismiss";
  } | null;

  const id = body?.id?.trim();
  const action = body?.action ?? "acknowledge";

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const reminder =
    action === "dismiss"
      ? await dismissReminder(id)
      : await acknowledgeReminder(id);

  if (!reminder) {
    return NextResponse.json({ error: "reminder not found" }, { status: 404 });
  }

  return NextResponse.json({ reminder });
}
