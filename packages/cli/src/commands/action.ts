import {
  listTwinActionsByStatus,
  updateTwinAction,
  type TwinActionStatus
} from "@twin-md/core/server";

export async function runActionListCommand(): Promise<void> {
  const open = listTwinActionsByStatus(["needs_approval", "pending"]);
  if (open.length === 0) {
    console.log("No twin actions need approval or execution.");
    return;
  }
  for (const request of open) {
    console.log(`${request.id} [${request.status}] ${request.request ?? ""}`);
  }
}

export async function runActionApproveCommand(id: string): Promise<void> {
  updateTwinAction(id, (request) => ({
    ...request,
    status: "pending",
    approvedAt: new Date().toISOString()
  }));
  console.log(`Approved ${id}. Claude Desktop or Claude Code can now pick it up with get_pending_twin_actions.`);
}

export async function runActionResolveCommand(
  id: string,
  status: Extract<TwinActionStatus, "done" | "failed" | "needs_user" | "cancelled">,
  result: string
): Promise<void> {
  updateTwinAction(id, (request) => ({
    ...request,
    status,
    result,
    resolvedAt: new Date().toISOString()
  }));
  console.log(`${status}: ${id}`);
}
