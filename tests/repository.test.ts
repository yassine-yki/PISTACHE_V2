import test from "node:test";
import assert from "node:assert/strict";
import { emptyProject, recordKey } from "../src/model.js";
import { LocalProjectRepository } from "../src/repositories/local-project-repository.js";

function memoryStorage(): Pick<Storage, "getItem" | "setItem"> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
  };
}

test("the repository contract keeps the UI independent from localStorage", async () => {
  const repository = new LocalProjectRepository(memoryStorage(), "mixed-use");
  const project = emptyProject();
  const key = recordKey(236, "bedroom", "paint");
  project.floors.r2.records[key] = {
    progress: 60,
    blocked: false,
    note: "",
    startDate: "",
    endDate: "",
  };

  await repository.save(project);
  assert.equal((await repository.load()).floors.r2.records[key].progress, 60);
});

test("project repositories keep progress isolated", async () => {
  const storage = memoryStorage();
  const first = new LocalProjectRepository(storage, "first-project");
  const second = new LocalProjectRepository(storage, "second-project");
  const project = emptyProject();
  const key = recordKey(201, "bedroom", "partitions");
  project.floors.r2.records[key] = {
    progress: 75,
    blocked: false,
    note: "",
    startDate: "",
    endDate: "",
  };

  await first.save(project);
  assert.equal((await first.load()).floors.r2.records[key].progress, 75);
  assert.equal((await second.load()).floors.r2.records[key], undefined);
});
