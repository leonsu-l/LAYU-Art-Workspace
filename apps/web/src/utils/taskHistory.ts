import type { GenerationTask } from '@nanobanana/shared/types/generation'

export function isActiveTask(task: GenerationTask): boolean {
  return task.status === 'queued' || task.status === 'running'
}

export function mergeTasks(previous: GenerationTask[], incoming: GenerationTask[]): GenerationTask[] {
  const byId = new Map(previous.map((task) => [task.id, task]))
  for (const task of incoming) {
    const existing = byId.get(task.id)
    // An older poll/POST acknowledgement must not roll back a terminal result.
    if (existing && (existing.updatedAt > task.updatedAt ||
      (!isActiveTask(existing) && existing.status !== task.status) ||
      (existing.status === 'running' && task.status === 'queued'))) continue
    byId.set(task.id, task)
  }
  return Array.from(byId.values()).sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

/** A successful full list is authoritative for deletions, except when a local mutation raced it. */
export function reconcileTaskHistory(
  previous: GenerationTask[], incoming: GenerationTask[], retainMissing: boolean, deleted: ReadonlySet<string>,
): GenerationTask[] {
  const visible = new Set(incoming.map((task) => task.id))
  return mergeTasks(previous.filter((task) => retainMissing || visible.has(task.id)), incoming)
    .filter((task) => !deleted.has(task.id))
}
