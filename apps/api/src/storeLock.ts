import { randomUUID } from 'node:crypto'
import { open, readFile, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'

interface Owner { pid: number; token: string }

// A second PORT must not create a second writer for the same DATA_DIR.
export async function lockStore(directory: string): Promise<() => Promise<void>> {
  const lockPath = resolve(directory, 'writer.lock')
  const recoveryPath = resolve(directory, 'writer-recovery.lock')
  const owner: Owner = { pid: process.pid, token: randomUUID() }
  const busy = () => new Error('DATA_DIR is already in use, or its writer lock needs inspection. Stop the other backend before retrying.')

  async function claim(): Promise<() => Promise<void>> {
    const file = await open(lockPath, 'wx', 0o600)
    try {
      await file.writeFile(JSON.stringify(owner))
    } finally {
      await file.close()
    }
    let released = false
    return async () => {
      if (released) return
      const current: Owner = JSON.parse(await readFile(lockPath, 'utf8'))
      if (current.token !== owner.token) throw busy()
      // Fixed, resolved path and ownership token verified before deleting the lock.
      await unlink(lockPath)
      released = true
    }
  }

  try {
    return await claim()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }

  // Only one process may inspect/remove a dead owner's lock. Without this second
  // exclusive lock, simultaneous recovery could delete a newly acquired writer lock.
  let recovery
  try {
    recovery = await open(recoveryPath, 'wx', 0o600)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw busy()
    throw error
  }
  try {
    await recovery.writeFile(JSON.stringify(owner))
    let previous: Owner | undefined
    try {
      previous = JSON.parse(await readFile(lockPath, 'utf8'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw busy()
    }
    if (previous) {
      if (!Number.isSafeInteger(previous.pid) || previous.pid < 1 || typeof previous.token !== 'string') throw busy()
      let alive = true
      try {
        process.kill(previous.pid, 0)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') alive = false
        else if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw busy()
      }
      if (alive) throw busy()
      // Fixed absolute path; dead PID established while holding the recovery lock.
      await unlink(lockPath)
    }
    try {
      return await claim()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw busy()
      throw error
    }
  } finally {
    await recovery.close()
    await unlink(recoveryPath)
  }
}
