import { spawn } from 'node:child_process'

type Operation = 'set' | 'get' | 'status' | 'delete'

export class KeychainStore {
  private readonly executable: string
  private readonly provider: 'huggingface' | 'openai'
  private cachedKey: string | null | undefined
  private pendingRead: Promise<string | null> | undefined
  private version = 0

  constructor(executable: string, provider: 'huggingface' | 'openai' = 'huggingface') {
    this.executable = executable
    this.provider = provider
  }

  private run(operation: Operation, input = ''): Promise<string | null> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.executable, [operation, this.provider], { stdio: ['pipe', 'pipe', 'ignore'] })
      let output = ''
      let settled = false
      const fail = () => {
        if (settled) return
        settled = true
        reject(new Error('Keychain unavailable'))
      }
      const timeout = setTimeout(() => { child.kill(); fail() }, 5000)
      child.on('error', fail)
      child.stdin.on('error', fail)
      child.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString('utf8')
        if (output.length > 4096) { child.kill(); fail() }
      })
      child.on('close', code => {
        clearTimeout(timeout)
        if (settled) return
        settled = true
        if (code === 2 && operation === 'get') resolve(null)
        else if (code === 0) resolve(output)
        else reject(new Error('Keychain unavailable'))
      })
      child.stdin.end(input)
    })
  }

  async set(key: string): Promise<void> {
    if (!key || key.length > 4096 || /[\r\n\0]/.test(key)) throw new Error('Invalid API key')
    if (await this.run('set', key) !== 'ok') throw new Error('Keychain unavailable')
    this.version++
    this.cachedKey = key
  }

  async get(): Promise<string | null> {
    if (this.cachedKey !== undefined) return this.cachedKey
    if (this.pendingRead) return this.pendingRead
    const version = this.version
    const pending = this.run('get').then(value => {
      if (version !== this.version) return this.cachedKey ?? null
      this.cachedKey = value || null
      return this.cachedKey
    }).finally(() => { if (this.pendingRead === pending) this.pendingRead = undefined })
    this.pendingRead = pending
    return pending
  }

  async status(): Promise<'configured' | 'missing'> {
    if (this.cachedKey !== undefined) return this.cachedKey ? 'configured' : 'missing'
    const result = await this.run('status')
    if (result === 'present') return 'configured'
    if (result === 'missing') return 'missing'
    throw new Error('Keychain unavailable')
  }

  async delete(): Promise<void> {
    if (await this.run('delete') !== 'ok') throw new Error('Keychain unavailable')
    this.version++
    this.cachedKey = null
  }
}
