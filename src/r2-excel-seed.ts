import { tasksByZone, type ProgressRecord, type ZoneId } from "./model.js";
import { R2_EXCEL_VALUES } from "./r2-excel-values.js";

const tasksBySourceColumn = new Map<string, { zone: ZoneId; taskId: string }>();

for (const [zone, tasks] of Object.entries(tasksByZone) as [ZoneId, readonly { id: string; sourceColumn: string }[]][]) {
  for (const task of tasks) tasksBySourceColumn.set(task.sourceColumn, { zone, taskId: task.id });
}

export const R2_EXCEL_RECORDS: Record<string, ProgressRecord> = {};

for (const value of R2_EXCEL_VALUES) {
  const task = tasksBySourceColumn.get(value.sourceColumn);
  if (!task) throw new Error(`Colonne Excel sans tâche : ${value.sourceColumn}`);
  R2_EXCEL_RECORDS[`${value.room}:${task.zone}:${task.taskId}`] = {
    progress: value.progress,
    blocked: false,
    note: value.note || "",
    startDate: "",
    endDate: "",
  };
}
