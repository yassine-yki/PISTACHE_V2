import type { Operation, Snapshot } from "./types.js";
export class OfflineStore {
  private database: Promise<IDBDatabase>;
  constructor(namespace: string) {
    this.database = new Promise((resolve, reject) => {
      const request = indexedDB.open("pistache-cloud:" + namespace, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("snapshots", { keyPath: "projectId" });
        request.result.createObjectStore("operations", { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async all<T>(name: string): Promise<T[]> {
    const db = await this.database;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(name, "readonly");
      const request = tx.objectStore(name).getAll();
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Lecture locale interrompue."));
    });
  }
  async snapshot(projectId: string): Promise<Snapshot | undefined> {
    return (await this.all<Snapshot>("snapshots")).find(s => s.projectId === projectId);
  }
  async saveSnapshot(snapshot: Snapshot): Promise<void> {
    const db = await this.database;
    return new Promise((resolve, reject) => {
      const tx = db.transaction("snapshots", "readwrite");
      tx.objectStore("snapshots").put(snapshot);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Sauvegarde locale interrompue."));
    });
  }
  async put(operation: Operation): Promise<void> {
    const db = await this.database;
    return new Promise((resolve, reject) => {
      const tx = db.transaction("operations", "readwrite");
      tx.objectStore("operations").put(operation);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Sauvegarde locale interrompue."));
    });
  }
  async acknowledge(operation: Operation, snapshot: Snapshot): Promise<void> {
    const db = await this.database;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["snapshots", "operations"], "readwrite");
      tx.objectStore("snapshots").put(snapshot);
      tx.objectStore("operations").delete(operation.id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Confirmation locale interrompue."));
    });
  }
  async close() { (await this.database).close(); }
}
