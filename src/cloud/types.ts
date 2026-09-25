import type { ProgressRecord } from "../model.js";
export type Role = "admin" | "worker" | "viewer";
export type CloudTask = {
  id: string; key: string; version: number; record: ProgressRecord; active: boolean;
};
export type Assignment = { id: string; room_task_id: string; assignee_id: string; ended_at: string | null };
export type Member = { user_id: string; role: Role; status: string; name: string };
export type Snapshot = {
  projectId: string; name: string; userId: string; role: Role;
  tasks: CloudTask[]; assignments: Assignment[]; members: Member[]; cachedAt: string;
};
export type Payload = {
  progress: number; blocked: boolean; note: string; start_date: string | null; end_date: string | null;
  correction_reason?: string; correction_note?: string;
};
export type Operation = {
  id: string; projectId: string; userId: string; deviceId: string; taskId: string; key: string;
  assignmentId: string | null; baseVersion: number; dependsOn: string | null;
  payload: Payload; createdAt: string; state: "pending" | "conflict" | "rejected" | "discarded";
  error?: string;
};
export type Receipt = { status: "accepted" | "conflict" | "rejected"; result_version: number | null; error_code: string | null };
export function editable(snapshot: Snapshot, userId: string, key: string, correction = false): boolean {
  const task = snapshot.tasks.find(item => item.key === key);
  if (!task?.active || snapshot.userId !== userId || snapshot.role === "viewer") return false;
  if (correction && snapshot.role === "admin") return true;
  return snapshot.assignments.some(a => a.room_task_id === task.id && a.assignee_id === userId && !a.ended_at);
}
export function recordFromPayload(payload: Payload): ProgressRecord {
  return { progress: payload.progress, blocked: payload.blocked, note: payload.note,
    startDate: payload.start_date || "", endDate: payload.end_date || "",
    ...(payload.correction_reason ? { lastCorrectionReason: payload.correction_reason as "input-error" | "scope-change", lastCorrectionNote: payload.correction_note } : {}) };
}
