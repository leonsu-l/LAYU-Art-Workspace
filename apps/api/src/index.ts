import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApplication } from './app.ts'
import { TaskStore } from './taskStore.ts'

// Keep API-owned data relative to this application, independently of the launch cwd.
const apiRoot = fileURLToPath(new URL('../', import.meta.url))
const port = Number(process.env.PORT ?? 3001)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535.')
const dataDirectory = resolve(apiRoot, process.env.DATA_DIR ?? 'data')
let store: TaskStore | undefined
const webDist = fileURLToPath(new URL('../../web/dist', import.meta.url))
const server = createApplication(() => store, webDist)
// Reserve the port before touching persisted tasks; accidentally starting twice must not
// mark the first process's running tasks as interrupted or execute queued tasks twice.
await new Promise<void>((resolve, reject) => {
  server.once('error', reject)
  server.listen(port, '127.0.0.1', resolve)
})
try {
  store = await TaskStore.open(dataDirectory)
  console.log(`NanoBanana backend: http://127.0.0.1:${port}`)
  console.log(`Persistent data: ${dataDirectory}`)
} catch (error) {
  server.close()
  throw error
}

let closing = false
async function shutdown() {
  if (closing) return
  closing = true
  console.log('Stopping backend; waiting for the current task to finish. Queued tasks remain on disk.')
  server.close()
  await store?.stop()
}
process.on('SIGINT', () => { void shutdown() })
process.on('SIGTERM', () => { void shutdown() })
