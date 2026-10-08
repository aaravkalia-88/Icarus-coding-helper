export type EntryAction = 'code' | 'models' | 'settings'

export function readEntryAction(data: unknown, source: MessageEventSource | null, frame: Window | null): EntryAction | null {
  if (!frame || source !== frame || typeof data !== 'object' || data === null || Array.isArray(data)) return null
  const { type, action } = data as Record<string, unknown>
  if (type !== 'icarus-entry-action') return null
  return action === 'code' || action === 'models' || action === 'settings' ? action : null
}
