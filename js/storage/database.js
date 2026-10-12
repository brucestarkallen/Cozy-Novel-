import { APP } from "../config.js";
export function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export function complete(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onabort = () =>
      reject(tx.error || new Error("Save transaction was cancelled."));
    tx.onerror = () => {};
  });
}
export function openDatabase(name = APP.database) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, APP.schema);
    req.onupgradeneeded = () => {
      const db = req.result;
      const records = db.createObjectStore("records", { keyPath: "id" });
      records.createIndex("novelId", "novelId");
      records.createIndex("type", "type");
      records.createIndex("ownerId", "ownerId");
      records.createIndex("sceneId", "sceneId");
      records.createIndex("parentSessionId", "parentSessionId");
      for (const n of ["meta", "blobs", "operations", "outbox", "recovery"])
        db.createObjectStore(n, { keyPath: "id" });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () =>
      reject(
        new Error(
          "Close another Cozy Novel tab to open this database version.",
        ),
      );
  });
}
