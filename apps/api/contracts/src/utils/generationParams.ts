import type { ProviderType } from '../types/generation.ts'
/** Only protocol fields supported by the application may cross the task boundary. */
export function taskParams(provider: ProviderType, value: object): Record<string, unknown> {
  const source = value as Record<string, unknown>
  const fields = provider === 'openai-compatible'
    ? ['size', 'quality', 'n', 'background', 'outputFormat', 'outputCompression', 'moderation']
    : ['imageSize', 'aspectRatio', 'imageOnly', 'thinkingLevel']
  return Object.fromEntries(fields.filter((key) => source[key] !== undefined && !(provider === 'gemini-compatible' && source[key] === 'auto')).map((key) => [key, source[key]]))
}
