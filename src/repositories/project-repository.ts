import type { ProjectData } from "../model.js";

export interface ProjectRepository {
  load(): Promise<ProjectData>;
  save(project: ProjectData): Promise<void>;
}
