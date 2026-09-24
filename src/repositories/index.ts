import { LocalProjectRepository } from "./local-project-repository.js";
import type { ProjectRepository } from "./project-repository.js";

export function createProjectRepository(storage: Storage, projectId: string): ProjectRepository {
  return new LocalProjectRepository(storage, projectId);
}

export type { ProjectRepository } from "./project-repository.js";
