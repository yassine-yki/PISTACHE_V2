import {
  CURRENT_FLOOR,
  SCHEMA_VERSION,
  emptyProject,
  type ProgressRecord,
  type ProjectData,
} from "./model.js";
import { R2_EXCEL_RECORDS } from "./r2-excel-seed.js";

export const PROJECT_KEY = "suivi-hotel-project-v1";
export const LEGACY_KEY = "suivi-hotel-r2-v1";
export const R2_EXCEL_IMPORT_KEY = "suivi-hotel-r2-excel-v1-imported";
export const BACKUP_FORMAT = "suivi-hotel-backup";

function scopedKey(baseKey: string, projectId: string): string {
  return projectId === "mixed-use" ? baseKey : `${baseKey}:${projectId}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseRecord(value: unknown): ProgressRecord {
  if (!isObject(value) || typeof value.progress !== "number" || !Number.isFinite(value.progress)
    || value.progress < 0 || value.progress > 100 || typeof value.blocked !== "boolean") {
    throw new Error("Avancement invalide dans la sauvegarde");
  }
  for (const field of ["note", "startDate", "endDate"] as const) {
    if (value[field] !== undefined && typeof value[field] !== "string") {
      throw new Error(`Champ ${field} invalide dans la sauvegarde`);
    }
  }
  if (value.lastCorrectionReason !== undefined
    && value.lastCorrectionReason !== "input-error"
    && value.lastCorrectionReason !== "scope-change") {
    throw new Error("Motif de correction invalide dans la sauvegarde");
  }
  for (const field of ["lastCorrectionNote", "correctedAt"] as const) {
    if (value[field] !== undefined && typeof value[field] !== "string") {
      throw new Error(`Champ ${field} invalide dans la sauvegarde`);
    }
  }
  return {
    ...(typeof value.confirmedDay === "string" ? {confirmedDay:value.confirmedDay} : {}),
    ...(typeof value.confirmedProgress === "number" ? {confirmedProgress:value.confirmedProgress} : {}),
    ...(typeof value.lockedProgress === "number" ? {lockedProgress:value.lockedProgress} : {}),
    ...(isObject(value.draftBefore) ? {draftBefore:parseRecord({...value.draftBefore,draftBefore:undefined})} : {}),
    ...(value.draftJustified===true ? {draftJustified:true} : {}),
    ...(value.draft===true ? {draft:true} : {}),
    progress: value.progress,
    blocked: value.blocked,
    note: (value.note as string | undefined) || "",
    startDate: (value.startDate as string | undefined) || "",
    endDate: (value.endDate as string | undefined) || "",
    ...(value.lastCorrectionReason ? { lastCorrectionReason: value.lastCorrectionReason } : {}),
    ...(value.lastCorrectionNote ? { lastCorrectionNote: value.lastCorrectionNote as string } : {}),
    ...(value.correctedAt ? { correctedAt: value.correctedAt as string } : {}),
  };
}

function parseRecords(value: unknown): Record<string, ProgressRecord> {
  if (!isObject(value)) throw new Error("Liste des avancements invalide");
  const records: Record<string, ProgressRecord> = {};
  for (const [key, record] of Object.entries(value)) {
    if (!/^\d+:(bedroom|bathroom|loggia):[a-z0-9-]+$/.test(key)) {
      throw new Error(`Identifiant d'avancement invalide : ${key}`);
    }
    records[key] = parseRecord(record);
  }
  return records;
}

export function parseProject(value: unknown): ProjectData {
  if (!isObject(value) || value.schemaVersion !== SCHEMA_VERSION || !isObject(value.floors)) {
    throw new Error("Format de projet non reconnu");
  }
  const floors: ProjectData["floors"] = {};
  for (const [floorId, floor] of Object.entries(value.floors)) {
    if (!/^[a-z0-9-]+$/.test(floorId) || !isObject(floor)) {
      throw new Error("Étage invalide dans la sauvegarde");
    }
    floors[floorId] = { records: parseRecords(floor.records) };
  }
  if (!floors[CURRENT_FLOOR]) floors[CURRENT_FLOOR] = { records: {} };
  return { schemaVersion: SCHEMA_VERSION, floors };
}

export function loadProject(storage: Pick<Storage, "getItem" | "setItem">, projectId = "mixed-use"): ProjectData {
  const projectKey = scopedKey(PROJECT_KEY, projectId);
  const importKey = scopedKey(R2_EXCEL_IMPORT_KEY, projectId);
  const current = storage.getItem(projectKey);
  const project = current !== null ? parseProject(JSON.parse(current) as unknown) : emptyProject();

  if (current === null && projectId === "mixed-use") {
    const legacy = storage.getItem(LEGACY_KEY);
    if (legacy !== null) project.floors[CURRENT_FLOOR].records = parseRecords(JSON.parse(legacy) as unknown);
  }

  if (projectId === "mixed-use" && storage.getItem(importKey) !== "1") {
    project.floors[CURRENT_FLOOR].records = {
      ...R2_EXCEL_RECORDS,
      ...project.floors[CURRENT_FLOOR].records,
    };
    storage.setItem(importKey, "1");
  }

  storage.setItem(projectKey, JSON.stringify(project));
  return project;
}

export function saveProject(storage: Pick<Storage, "setItem">, project: ProjectData, projectId = "mixed-use"): void {
  storage.setItem(scopedKey(PROJECT_KEY, projectId), JSON.stringify(parseProject(project)));
}

export function createBackup(project: ProjectData, exportedAt = new Date()): string {
  return JSON.stringify({
    format: BACKUP_FORMAT,
    exportedAt: exportedAt.toISOString(),
    project: parseProject(project),
  }, null, 2);
}

export function parseBackup(source: string): ProjectData {
  const backup: unknown = JSON.parse(source);
  if (!isObject(backup) || backup.format !== BACKUP_FORMAT) {
    throw new Error("Ce fichier n'est pas une sauvegarde Suivi Hôtel");
  }
  return parseProject(backup.project);
}
