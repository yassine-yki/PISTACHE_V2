import { loadProject, saveProject } from "../storage.js";
import type { ProjectData } from "../model.js";
import type { ProjectRepository } from "./project-repository.js";

export class LocalProjectRepository implements ProjectRepository {
  constructor(
    private readonly storage: Pick<Storage, "getItem" | "setItem">,
    private readonly projectId: string,
  ) {}

  async load(): Promise<ProjectData> {
    return loadProject(this.storage, this.projectId);
  }

  async save(project: ProjectData): Promise<void> {
    saveProject(this.storage, project, this.projectId);
  }
}
