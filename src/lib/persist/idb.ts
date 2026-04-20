const IDB_NAME = 'my-finance-local-v1'
const STORE = 'kv'
const KEY_DB = 'sqlite'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function idbLoadDb(): Promise<ArrayBuffer | null> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const getReq = tx.objectStore(STORE).get(KEY_DB)
    getReq.onsuccess = () => {
      const v = getReq.result
      if (v instanceof ArrayBuffer) resolve(v)
      else if (v instanceof Uint8Array) {
        const copy = new Uint8Array(v.byteLength)
        copy.set(v)
        resolve(copy.buffer)
      } else resolve(null)
    }
    getReq.onerror = () => reject(getReq.error)
  })
}

export async function idbSaveDb(data: Uint8Array): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(data, KEY_DB)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/** Apaga o banco SQLite guardado no navegador (contas, lançamentos, etc.). */
export function idbDeleteEntireDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(IDB_NAME)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error ?? new Error('Falha ao apagar IndexedDB'))
    req.onblocked = () => reject(new Error('Outra aba está usando o banco; feche e tente de novo.'))
  })
}
