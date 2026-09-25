import type { ProgressRecord } from "../model.js";
import { OfflineStore } from "./offline-store.js";
import { editable, recordFromPayload, type Snapshot, type Operation, type Receipt } from "./types.js";

export class SyncEngine {
  constructor(
    readonly store: OfflineStore, readonly userId: string, readonly deviceId: string,
    private submit: (operation: Operation) => Promise<Receipt>,
  ) {}
  async operations(projectId: string): Promise<Operation[]> {
    return (await this.store.all<Operation>("operations"))
      .filter(o => o.userId === this.userId && o.projectId === projectId && o.state !== "discarded");
  }
  async enqueue(projectId: string, key: string, record: ProgressRecord, correction: {reason: string; note: string} | null = null, expectedRecord?: ProgressRecord, expectedVersion?: number) {
    const snapshot = await this.store.snapshot(projectId);
    if (!snapshot || !editable(snapshot, this.userId, key, Boolean(correction))) throw new Error("Cette tâche ne vous est pas affectée.");
    const task = snapshot.tasks.find(t => t.key === key)!;
    if (expectedVersion !== undefined && expectedVersion !== task.version) throw new Error("Cette tâche a changé dans un autre onglet. Actualisez avant de modifier.");
    if (expectedRecord) {
      const visible = (await this.records(projectId))[key];
      if (["progress","blocked","note","startDate","endDate"].some(field => visible[field as keyof ProgressRecord] !== expectedRecord[field as keyof ProgressRecord]))
        throw new Error("Une saisie existe dans un autre onglet. Actualisez avant de modifier.");
    }
    const related = (await this.operations(projectId)).filter(o => o.taskId === task.id);
    if (related.some(o => o.state !== "pending")) throw new Error("Résolvez d'abord la modification en conflit.");
    // Chain by version, never by the device clock or IndexedDB's UUID ordering.
    const previous = related.sort((a,b) => b.baseVersion - a.baseVersion)[0];
    const assignment = snapshot.assignments.find(a => a.room_task_id === task.id && a.assignee_id === this.userId && !a.ended_at);
    const operation: Operation = {
      id: crypto.randomUUID(), projectId, userId: this.userId, deviceId: this.deviceId,
      taskId: task.id, key, assignmentId: assignment?.id || null,
      baseVersion: previous ? previous.baseVersion + 1 : task.version,
      dependsOn: previous?.id || null, createdAt: new Date().toISOString(), state: "pending",
      payload: { progress: record.progress, blocked: record.blocked, note: record.note,
        start_date: record.startDate || null, end_date: record.endDate || null,
        ...(correction ? { correction_reason: correction.reason, correction_note: correction.note } : {}) },
    };
    await this.store.put(operation);
    return operation;
  }
  async records(projectId: string): Promise<Record<string, ProgressRecord>> {
    const snapshot = await this.store.snapshot(projectId);
    const result = Object.fromEntries((snapshot?.tasks || []).map(t => [t.key, t.record]));
    for (const operation of (await this.operations(projectId)).filter(o => o.state === "pending").sort((a,b) => a.baseVersion-b.baseVersion)) {
      result[operation.key] = recordFromPayload(operation.payload);
    }
    return result;
  }
  async flush(projectId: string) {
    const queue = (await this.operations(projectId)).sort((a,b) => a.baseVersion-b.baseVersion);
    for (const operation of queue) {
      if (operation.state !== "pending") continue;
      const dependency = queue.find(o => o.id === operation.dependsOn);
      if (dependency && dependency.state !== "pending") {
        operation.state = "rejected"; operation.error = "dependency_failed"; await this.store.put(operation); continue;
      }
      const receipt = await this.submit(operation); // Network/auth errors keep the exact envelope for retry.
      if (receipt.status !== "accepted") {
        operation.state = receipt.status; operation.error = receipt.error_code || "unknown";
        await this.store.put(operation);
        continue;
      }
      const snapshot = await this.store.snapshot(projectId);
      if (!snapshot) throw new Error("Cache du projet introuvable.");
      const task = snapshot.tasks.find(t => t.id === operation.taskId);
      if (task && Number(receipt.result_version) >= task.version) {
        task.record = recordFromPayload(operation.payload);
        task.version = Number(receipt.result_version);
      }
      await this.store.acknowledge(operation, snapshot);
    }
  }
  async discard(projectId: string, taskId: string) {
    for (const operation of await this.operations(projectId)) if (operation.taskId === taskId && operation.state !== "pending") {
      operation.state = "discarded"; await this.store.put(operation);
    }
  }
}
