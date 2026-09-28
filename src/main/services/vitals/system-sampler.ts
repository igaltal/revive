import si from 'systeminformation'
import type { Exec } from '../../exec'
import type { Reading, VitalsSampler } from './vitals-service'

const OLLAMA = 'http://127.0.0.1:11434'

/** Reads this computer with systeminformation (macOS and Linux). */
export function systemSampler(opts: { name: string; exec: Exec }): VitalsSampler {
  let machine: Reading['machine'] | null = null
  // Whether Ollama is installed changes rarely: checked at most every five minutes.
  let ollamaInstalled: { at: number; value: boolean } | null = null

  const installed = async () => {
    if (ollamaInstalled && Date.now() - ollamaInstalled.at < 5 * 60_000) return ollamaInstalled.value
    const r = await opts.exec('ollama', ['--version'], { timeoutMs: 3000 }).catch(() => null)
    ollamaInstalled = { at: Date.now(), value: r?.code === 0 }
    return ollamaInstalled.value
  }

  const ollama = async (): Promise<Reading['ollama']> => {
    try {
      // Local only: loopback, a one second timeout.
      const res = await fetch(`${OLLAMA}/api/ps`, { signal: AbortSignal.timeout(1000) })
      if (!res.ok) return { state: 'stopped', models: [] }
      const body = (await res.json()) as { models?: Array<{ name?: string }> }
      return { state: 'running', models: (body.models ?? []).map((m) => String(m.name ?? '')).filter(Boolean).slice(0, 20) }
    } catch {
      return { state: (await installed()) ? 'stopped' : 'missing', models: [] }
    }
  }

  return {
    async sample() {
      if (!machine) {
        const [cpu, mem] = await Promise.all([si.cpu(), si.mem()])
        machine = { name: opts.name, cpu: `${cpu.manufacturer} ${cpu.brand}`.trim(), cores: cpu.cores, memoryBytes: mem.total }
      }
      const [load, mem, disks, temp, o] = await Promise.all([si.currentLoad(), si.mem(), si.fsSize(), si.cpuTemperature().catch(() => null), ollama()])
      // On macOS the root volume is a sealed snapshot; the user's data lives on the Data volume.
      const disk = disks.find((d) => d.mount === '/System/Volumes/Data') ?? disks.find((d) => d.mount === '/')
      const t = temp?.main ?? temp?.max ?? null
      return {
        machine,
        cpu: round(load.currentLoad),
        memory: round(mem.total ? ((mem.total - mem.available) / mem.total) * 100 : 0),
        disk: round(disk?.use ?? 0),
        temperature: typeof t === 'number' && Number.isFinite(t) && t > 0 ? round(t) : null,
        uptimeSeconds: Math.round(si.time().uptime),
        ollama: o
      }
    }
  }
}

const round = (n: number) => Math.round(n * 10) / 10
