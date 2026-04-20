import type { Database } from 'sql.js'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createFinanceDatabase } from '../lib/db/openDb'
import { idbDeleteEntireDatabase, idbLoadDb, idbSaveDb } from '../lib/persist/idb'
import {
  getDriveOauthClientId,
  getDriveRootFolderId,
  setDriveOauthClientId,
  setDriveRootFolderId,
} from '../lib/settings/driveFolder'
import { FinanceDbContext } from './financeDbContext'

export function FinanceDbProvider({ children }: { children: ReactNode }) {
  const dbRef = useRef<Database | null>(null)
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const [dbEpoch, setDbEpoch] = useState(0)

  const touch = useCallback(() => setVersion((v) => v + 1), [])
  const bumpDbEpoch = useCallback(() => setDbEpoch((e) => e + 1), [])

  const persistNow = useCallback(async () => {
    const db = dbRef.current
    if (!db) return
    await idbSaveDb(db.export())
  }, [])

  const persistSoon = useCallback(() => {
    if (persistTimer.current) clearTimeout(persistTimer.current)
    persistTimer.current = setTimeout(() => {
      void persistNow()
    }, 450)
  }, [persistNow])

  useEffect(() => {
    return () => {
      if (persistTimer.current) clearTimeout(persistTimer.current)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const buf = await idbLoadDb()
        const db = await createFinanceDatabase(buf ?? undefined)
        if (cancelled) {
          db.close()
          return
        }
        dbRef.current = db
        setReady(true)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Não foi possível abrir o SQLite local')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    return () => {
      dbRef.current?.close()
      dbRef.current = null
    }
  }, [])

  const getDb = useCallback(() => {
    const db = dbRef.current
    if (!db) throw new Error('Banco ainda não está pronto')
    return db
  }, [])

  const replaceDatabaseFromFile = useCallback(
    async (file: File) => {
      const prev = dbRef.current
      const preOauth = prev ? getDriveOauthClientId(prev).trim() : ''
      const preRoot = prev ? getDriveRootFolderId(prev).trim() : ''
      const buf = await file.arrayBuffer()
      prev?.close()
      const db = await createFinanceDatabase(buf)
      /** O backup do Drive é um snapshot antigo: pode não ter `drive.*` na meta. Mantém o que já estava no app. */
      if (preOauth) setDriveOauthClientId(db, preOauth)
      if (preRoot) setDriveRootFolderId(db, preRoot)
      dbRef.current = db
      bumpDbEpoch()
      touch()
      await idbSaveDb(db.export())
    },
    [touch, bumpDbEpoch],
  )

  const exportDatabaseFile = useCallback(() => {
    const db = dbRef.current
    if (!db) return
    const data = db.export()
    const blob = new Blob([Uint8Array.from(data)], { type: 'application/x-sqlite3' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `my-finance-${new Date().toISOString().slice(0, 10)}.sqlite`
    a.click()
    URL.revokeObjectURL(url)
  }, [])

  const clearAllLocalData = useCallback(async () => {
    if (persistTimer.current) clearTimeout(persistTimer.current)
    dbRef.current?.close()
    dbRef.current = null
    await idbDeleteEntireDatabase()
    const db = await createFinanceDatabase(undefined)
    dbRef.current = db
    await idbSaveDb(db.export())
    bumpDbEpoch()
    touch()
  }, [touch, bumpDbEpoch])

  const value = useMemo(
    () => ({
      ready,
      error,
      version,
      dbEpoch,
      getDb,
      touch,
      persistSoon,
      persistNow,
      replaceDatabaseFromFile,
      exportDatabaseFile,
      clearAllLocalData,
    }),
    [ready, error, version, dbEpoch, getDb, touch, persistSoon, persistNow, replaceDatabaseFromFile, exportDatabaseFile, clearAllLocalData],
  )

  if (error) {
    return (
      <div className="flex min-h-svh items-center justify-center p-6 text-danger">
        {error}
      </div>
    )
  }

  if (!ready) {
    return (
      <div className="flex min-h-svh items-center justify-center p-6 text-zinc-400">
        Carregando banco local…
      </div>
    )
  }

  return <FinanceDbContext.Provider value={value}>{children}</FinanceDbContext.Provider>
}
