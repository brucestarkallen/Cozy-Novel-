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
    const req = indexedDB.open(name, APP.databaseVersion);
    req.onupgradeneeded = () => {
      const db = req.result;
      const records = db.objectStoreNames.contains("records")
        ? req.transaction.objectStore("records")
        : db.createObjectStore("records", { keyPath: "id" });
      for (const index of [
        "novelId",
        "type",
        "ownerId",
        "sceneId",
        "parentSessionId",
      ])
        if (!records.indexNames.contains(index))
          records.createIndex(index, index);
      for (const name of ["meta", "blobs", "operations", "outbox", "recovery"])
        if (!db.objectStoreNames.contains(name))
          db.createObjectStore(name, { keyPath: "id" });
      const meta = req.transaction.objectStore("meta"),
        library = meta.get("library");
      library.onsuccess = () => {
        if (library.result)
          meta.put({
            ...library.result,
            minimumWriter: APP.writerProtocol,
            commitSequence: library.result.commitSequence || 0,
          });
      };
      meta.put({
        id: "compatibility",
        minimumWriter: APP.writerProtocol,
        databaseVersion: APP.databaseVersion,
      });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        globalThis.dispatchEvent?.(new Event("cozynovelversionchange"));
      };
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
