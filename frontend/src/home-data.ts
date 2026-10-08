import type { ModeId } from './icarus'

export const features: { id: ModeId | 'memory' | 'model'; label: string; title: string; copy: string; symbol: string }[] = [
  { id: 'hint', label: 'HINT MODE', title: 'Nudge me. Don’t solve it.', copy: 'Just enough direction to find your own way forward.', symbol: '✧' },
  { id: 'explain_mistake', label: 'EXPLAIN MY MISTAKE', title: 'Where did my logic break?', copy: 'Find the assumption that led you off course.', symbol: '↳' },
  { id: 'logic_coach', label: 'IMPROVE LOGIC', title: 'A clearer line of thought.', copy: 'Refine your approach. Keep the reasoning yours.', symbol: '◇' },
  { id: 'fix_code', label: 'FIX CODE', title: 'Repair it with me.', copy: 'Understand the bug, then make the smallest useful fix.', symbol: '⌁' },
  { id: 'full_solve', label: 'FULL SOLVE', title: 'Show the complete path.', copy: 'The reasoning, the solution, and why it works.', symbol: '↗' },
  { id: 'ask_icarus', label: 'ASK ICARUS', title: 'Think it through together.', copy: 'A second perspective on the code in front of you.', symbol: '✦' },
  { id: 'explain_code', label: 'EXPLAIN CODE', title: 'Understand every step.', copy: 'Walk through what your code does and why it works.', symbol: '≡' },
  { id: 'refactor', label: 'REFACTOR', title: 'Same intent. Clearer code.', copy: 'Improve the structure while preserving what your code does.', symbol: '⌁' },
  { id: 'memory', label: 'PROJECT MEMORY', title: 'Keep what you’ve learned.', copy: 'Your project, goals, and decisions. Saved on this Mac.', symbol: '≡' },
  { id: 'model', label: 'CONNECT YOUR MODEL', title: 'Bring your own intelligence.', copy: 'Manage the Qwen connection and your private access key.', symbol: '◉' },
]

export type HomeAction = { action: 'mode'; mode: ModeId } | { action: 'memory' | 'settings' | 'archive' }

export function readHomeAction(data: unknown): HomeAction | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const { type, action, mode } = data as Record<string, unknown>
  if (type !== 'icarus-home-action') return null
  if (action === 'memory' || action === 'settings' || action === 'archive') return { action }
  if (action === 'mode' && typeof mode === 'string' && features.some(feature => feature.id === mode && feature.id !== 'memory' && feature.id !== 'model')) {
    return { action, mode: mode as ModeId }
  }
  return null
}

export type ProjectMemory = { project: string; goal: string; notes: string }
export const memoryKey = 'icarus-project-memory-v1'

export function storyProgress(scrollTop: number, start: number, height: number, viewport: number): number {
  return Math.max(0, Math.min(1, (scrollTop - start) / Math.max(1, height - viewport)))
}

export function parseMemory(raw: string | null): ProjectMemory | null {
  try {
    if (!raw || raw.length > 60000) return null
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const { project, goal, notes } = value as Record<string, unknown>
    if (typeof project !== 'string' || project.length > 160
      || typeof goal !== 'string' || goal.length > 500
      || typeof notes !== 'string' || notes.length > 8000) return null
    return { project, goal, notes }
  } catch { return null }
}
