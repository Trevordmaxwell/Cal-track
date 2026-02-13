// IndexedDB wrapper (tiny, no deps)

const DB_NAME = "pocket-balance";
const DB_VERSION = 1;

let _dbPromise = null;

export function openDb(){
  if(_dbPromise) return _dbPromise;

  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;

      if(!db.objectStoreNames.contains("entries")){
        const store = db.createObjectStore("entries", { keyPath: "id" });
        store.createIndex("by_ts", "ts");
        store.createIndex("by_day", "day");
        store.createIndex("by_type", "type");
      }

      if(!db.objectStoreNames.contains("settings")){
        db.createObjectStore("settings", { keyPath: "key" });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  return _dbPromise;
}

function tx(db, storeName, mode="readonly"){
  return db.transaction(storeName, mode).objectStore(storeName);
}

export async function putSetting(key, value){
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const store = tx(db, "settings", "readwrite");
    const req = store.put({ key, value });
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

export async function getSetting(key){
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const store = tx(db, "settings", "readonly");
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result ? req.result.value : null);
    req.onerror = () => reject(req.error);
  });
}

export async function getAllSettings(){
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const store = tx(db, "settings", "readonly");
    const req = store.getAll();
    req.onsuccess = () => {
      const out = {};
      for(const row of req.result || []){
        out[row.key] = row.value;
      }
      resolve(out);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function addEntry(entry){
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const store = tx(db, "entries", "readwrite");
    const req = store.put(entry);
    req.onsuccess = () => resolve(entry.id);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteEntry(id){
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const store = tx(db, "entries", "readwrite");
    const req = store.delete(id);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

export async function getRecentEntries(limit=10){
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const store = tx(db, "entries", "readonly");
    const index = store.index("by_ts");

    // Iterate backwards
    const out = [];
    const req = index.openCursor(null, "prev");

    req.onsuccess = () => {
      const cursor = req.result;
      if(!cursor || out.length >= limit){
        resolve(out);
        return;
      }
      out.push(cursor.value);
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getEntriesByDay(day){
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const store = tx(db, "entries", "readonly");
    const index = store.index("by_day");
    const range = IDBKeyRange.only(day);
    const req = index.getAll(range);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function getEntriesBetweenDays(dayStart, dayEnd){
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const store = tx(db, "entries", "readonly");
    const index = store.index("by_day");
    const range = IDBKeyRange.bound(dayStart, dayEnd);
    const req = index.getAll(range);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function getAllEntries(){
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const store = tx(db, "entries", "readonly");
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function wipeAll(){
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(["entries","settings"], "readwrite");
    t.objectStore("entries").clear();
    t.objectStore("settings").clear();
    t.oncomplete = () => resolve(true);
    t.onerror = () => reject(t.error);
  });
}
