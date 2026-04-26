import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export type TwinActionStatus =
  | "needs_approval"
  | "pending"
  | "done"
  | "failed"
  | "needs_user"
  | "cancelled";

export type TwinActionRequest = Record<string, unknown> & {
  id?: string;
  request?: string;
  status?: TwinActionStatus | string;
};

export function twinActionQueuePath(): string {
  return path.join(os.homedir(), ".claude", "twin", "action-requests.jsonl");
}

export function readTwinActionRequests(): TwinActionRequest[] {
  const queuePath = twinActionQueuePath();
  if (!existsSync(queuePath)) return [];
  return readFileSync(queuePath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as TwinActionRequest;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is TwinActionRequest => Boolean(entry));
}

export function writeTwinActionRequests(requests: TwinActionRequest[]): void {
  const queuePath = twinActionQueuePath();
  mkdirSync(path.dirname(queuePath), { recursive: true });
  writeFileSync(queuePath, requests.map((request) => JSON.stringify(request)).join("\n") + "\n", "utf8");
}

export function listTwinActionsByStatus(statuses: TwinActionStatus[]): TwinActionRequest[] {
  const wanted = new Set<string>(statuses);
  return readTwinActionRequests().filter((request) => wanted.has(String(request.status ?? "")));
}

export function updateTwinAction(
  id: string,
  updater: (request: TwinActionRequest) => TwinActionRequest
): TwinActionRequest {
  const requests = readTwinActionRequests();
  let updatedRequest: TwinActionRequest | null = null;
  const updated = requests.map((request) => {
    if (request.id !== id) return request;
    updatedRequest = updater(request);
    return updatedRequest;
  });
  if (!updatedRequest) {
    throw new Error(`No twin action found for ${id}`);
  }
  writeTwinActionRequests(updated);
  return updatedRequest;
}
