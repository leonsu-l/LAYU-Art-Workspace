// Each session owns a separate map. Late completions retain only their old handle.
export class StudioCache {
  private entries = new Map<string, unknown>()
  get<T>(key: string): T | undefined { return this.entries.get(key) as T | undefined }
  set<T>(key: string, value: T) { this.entries.set(key, value) }
  clear() { this.entries.clear() }
}
