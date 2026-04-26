import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

type ActionRequest = Record<string, unknown> & {
  id?: string;
  request?: string;
  status?: string;
};

function queuePath(): string {
  return path.join(os.homedir(), ".claude", "twin", "action-requests.jsonl");
}

function readRequests(): ActionRequest[] {
  const file = queuePath();
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as ActionRequest;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is ActionRequest => Boolean(entry));
}

function writeRequests(requests: ActionRequest[]): void {
  const file = queuePath();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, requests.map((request) => JSON.stringify(request)).join("\n") + "\n", "utf8");
}

export async function runActionListCommand(): Promise<void> {
  const requests = readRequests();
  const open = requests.filter((request) =>
    ["needs_approval", "pending"].includes(String(request.status ?? ""))
  );
  if (open.length === 0) {
    console.log("No twin actions need approval or execution.");
    return;
  }
  for (const request of open) {
    console.log(`${request.id} [${request.status}] ${request.request ?? ""}`);
  }
}

export async function runActionApproveCommand(id: string): Promise<void> {
  const requests = readRequests();
  let found = false;
  const updated = requests.map((request) => {
    if (request.id !== id) return request;
    found = true;
    return {
      ...request,
      status: "pending",
      approvedAt: new Date().toISOString()
    };
  });
  if (!found) {
    throw new Error(`No twin action found for ${id}`);
  }
  writeRequests(updated);
  console.log(`Approved ${id}. Claude Desktop can now pick it up with get_pending_twin_actions.`);
}

export async function runActionResolveCommand(
  id: string,
  status: "done" | "failed" | "needs_user",
  result: string
): Promise<void> {
  const requests = readRequests();
  let found = false;
  const updated = requests.map((request) => {
    if (request.id !== id) return request;
    found = true;
    return {
      ...request,
      status,
      result,
      resolvedAt: new Date().toISOString()
    };
  });
  if (!found) {
    throw new Error(`No twin action found for ${id}`);
  }
  writeRequests(updated);
  console.log(`${status}: ${id}`);
}
