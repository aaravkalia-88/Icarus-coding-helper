import { spawn } from 'node:child_process'

export type SelectionTarget = { pid: number; name: string }
export type SelectionBounds = { x: number; y: number; width: number; height: number }
export type CaptureResult = { status: 'selected' | 'empty' | 'permission_needed' | 'unavailable'; selectedText?: string; bounds?: SelectionBounds }
export type SelectionInvocation = { selectedText: string | null; permissionRequired: boolean; sourceApp?: string; captureStatus?: CaptureResult['status']; bounds?: SelectionBounds; mode?: string }

export class SelectionSession {
  private target: SelectionTarget | null = null
  private version = 0
  private busy = false
  private read: (target: SelectionTarget) => Promise<CaptureResult>
  invocation: SelectionInvocation = { selectedText: null, permissionRequired: false }

  constructor(read: (target: SelectionTarget) => Promise<CaptureResult>) { this.read = read }

  async capture(target: SelectionTarget | null, mode?: string) {
    this.prepare(target, mode)
    return this.allow()
  }

  prepare(target: SelectionTarget | null, mode?: string) {
    this.version++
    this.busy = false
    this.target = target
    this.invocation = { selectedText: null, permissionRequired: Boolean(target),
      ...(target ? { sourceApp: target.name } : {}), ...(mode ? { mode } : {}) }
  }

  deny() {
    this.version++
    this.target = null
    this.busy = false
    this.invocation = { ...this.invocation, selectedText: null, permissionRequired: false, bounds: undefined }
    return this.invocation
  }

  async allow() {
    if (!this.target || !this.invocation.permissionRequired || this.busy) return this.invocation
    const version = this.version
    const target = this.target
    this.busy = true
    let result: CaptureResult
    try { result = await this.read(target) } catch { result = { status: 'unavailable' } }
    if (version !== this.version) return this.invocation
    this.busy = false
    const text = result.status === 'selected' && typeof result.selectedText === 'string'
      && result.selectedText.trim() && result.selectedText.length <= 65536 ? result.selectedText : null
    const bounds = result.bounds && Object.values(result.bounds).every(Number.isFinite)
      && result.bounds.width >= 0 && result.bounds.height >= 0 ? result.bounds : undefined
    this.invocation = { ...this.invocation, selectedText: text,
      permissionRequired: result.status === 'permission_needed', captureStatus: text ? 'selected' : result.status,
      ...(text && bounds ? { bounds } : {}) }
    return this.invocation
  }
}

export class SelectionHelper {
  private executable: string
  constructor(executable: string) { this.executable = executable }

  private run(operation: 'target' | 'capture', pid?: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.executable, [operation], { stdio: ['pipe', 'pipe', 'ignore'] })
      let output = ''
      const timeout = setTimeout(() => child.kill(), 5000)
      child.on('error', reject)
      child.stdin.on('error', () => {})
      child.stdout.on('data', (part: Buffer) => {
        output += part.toString('utf8')
        if (Buffer.byteLength(output) > 300000) child.kill()
      })
      child.on('close', code => {
        clearTimeout(timeout)
        if (code !== 0) { reject(new Error('Selection unavailable')); return }
        try { resolve(JSON.parse(output)) } catch { reject(new Error('Selection unavailable')) }
      })
      child.stdin.end(pid ? JSON.stringify({ pid }) : '')
    })
  }

  async target(): Promise<SelectionTarget | null> {
    const value = await this.run('target') as Partial<SelectionTarget>
    return Number.isInteger(value?.pid) && Number(value.pid) > 0
      && typeof value.name === 'string' && value.name.length <= 160
      ? value as SelectionTarget : null
  }

  async capture(target: SelectionTarget): Promise<CaptureResult> {
    return await this.run('capture', target.pid) as CaptureResult
  }
}
