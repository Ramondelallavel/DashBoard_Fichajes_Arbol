/**
 * Almacenamiento local clave-valor. Implementación sobre IndexedDB con alternativa en memoria
 * (si el navegador bloquea el almacenamiento, la aplicación sigue funcionando y lo indica).
 * Esta interfaz es el punto de sustitución por una API/servidor en una fase posterior.
 */
export type StoreName = 'batches' | 'raw' | 'datasets' | 'profiles' | 'settings' | 'reviews' | 'manual' | 'filters' | 'meta';

export const STORES: StoreName[] = ['batches', 'raw', 'datasets', 'profiles', 'settings', 'reviews', 'manual', 'filters', 'meta'];

export interface KV {
  mode: 'indexeddb' | 'memoria';
  get<T>(store: StoreName, key: string): Promise<T | undefined>;
  set<T>(store: StoreName, key: string, value: T): Promise<void>;
  del(store: StoreName, key: string): Promise<void>;
  getAll<T>(store: StoreName): Promise<T[]>;
  clear(store: StoreName): Promise<void>;
}

const DB_NAME = 'planificacion-industrial';
const DB_VERSION = 1;

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

class IdbKV implements KV {
  mode = 'indexeddb' as const;
  constructor(private db: IDBDatabase) {}
  private store(name: StoreName, mode: IDBTransactionMode) {
    return this.db.transaction(name, mode).objectStore(name);
  }
  async get<T>(store: StoreName, key: string) {
    return (await req(this.store(store, 'readonly').get(key))) as T | undefined;
  }
  async set<T>(store: StoreName, key: string, value: T) {
    const tx = this.db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value, key);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
  async del(store: StoreName, key: string) {
    await req(this.store(store, 'readwrite').delete(key));
  }
  async getAll<T>(store: StoreName) {
    return (await req(this.store(store, 'readonly').getAll())) as T[];
  }
  async clear(store: StoreName) {
    await req(this.store(store, 'readwrite').clear());
  }
}

export class MemoryKV implements KV {
  mode = 'memoria' as const;
  private data = new Map<StoreName, Map<string, unknown>>();
  private s(name: StoreName) {
    let m = this.data.get(name);
    if (!m) {
      m = new Map();
      this.data.set(name, m);
    }
    return m;
  }
  async get<T>(store: StoreName, key: string) {
    return this.s(store).get(key) as T | undefined;
  }
  async set<T>(store: StoreName, key: string, value: T) {
    this.s(store).set(key, structuredClone(value));
  }
  async del(store: StoreName, key: string) {
    this.s(store).delete(key);
  }
  async getAll<T>(store: StoreName) {
    return [...this.s(store).values()] as T[];
  }
  async clear(store: StoreName) {
    this.s(store).clear();
  }
}

export async function openStorage(): Promise<KV> {
  try {
    if (typeof indexedDB === 'undefined') return new MemoryKV();
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
    };
    const db = await Promise.race([
      req(open),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000)),
    ]);
    const kv = new IdbKV(db);
    // comprobación de escritura (algunos navegadores en modo privado fallan aquí)
    await kv.set('meta', '__probe', Date.now());
    return kv;
  } catch {
    return new MemoryKV();
  }
}
