/** A small promise wrapper around IndexedDB for Kanban's offline support (K4): two stores, "cache"
 * (the boards and tasks last seen) and "queue" (changes made without a connection, photos included).
 * Where IndexedDB is not available (some private windows) everything still works, just in memory. */
const DB = 'ncode-kanban';
export type StoreName = 'cache' | 'queue' | 'meta';

let opening: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (opening) return opening;
  opening = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache');
        if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue', { keyPath: 'id', autoIncrement: true });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opening;
}

const memory: Record<StoreName, Map<IDBValidKey, unknown>> = { cache: new Map(), queue: new Map(), meta: new Map() };
let memoryId = 0;

function run<T>(store: StoreName, mode: IDBTransactionMode, work: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  return open().then(
    (db) =>
      new Promise<T | undefined>((resolve) => {
        if (!db) return resolve(undefined);
        try {
          const req = work(db.transaction(store, mode).objectStore(store));
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(undefined);
        } catch {
          resolve(undefined);
        }
      }),
  );
}

export async function put(store: StoreName, value: unknown, key?: IDBValidKey): Promise<IDBValidKey | undefined> {
  const db = await open();
  if (!db) {
    const k = key ?? ++memoryId;
    memory[store].set(k, store === 'queue' ? { ...(value as object), id: k } : value);
    return k;
  }
  return run(store, 'readwrite', (s) => (key === undefined ? s.put(value) : s.put(value, key)));
}

export async function get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
  const db = await open();
  if (!db) return memory[store].get(key) as T | undefined;
  return run<T>(store, 'readonly', (s) => s.get(key) as IDBRequest<T>);
}

export async function remove(store: StoreName, key: IDBValidKey): Promise<void> {
  const db = await open();
  if (!db) {
    memory[store].delete(key);
    return;
  }
  await run(store, 'readwrite', (s) => s.delete(key));
}

export async function all<T>(store: StoreName): Promise<T[]> {
  const db = await open();
  if (!db) return [...memory[store].values()] as T[];
  return (await run<T[]>(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>)) ?? [];
}

export async function keys(store: StoreName): Promise<IDBValidKey[]> {
  const db = await open();
  if (!db) return [...memory[store].keys()];
  return (await run<IDBValidKey[]>(store, 'readonly', (s) => s.getAllKeys())) ?? [];
}

export async function clear(store: StoreName): Promise<void> {
  const db = await open();
  if (!db) {
    memory[store].clear();
    return;
  }
  await run(store, 'readwrite', (s) => s.clear());
}
