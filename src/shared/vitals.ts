import { z } from 'zod'

/** The Host's health, as the Home screen shows it (docs/HOST_PRD.md H6). */
export const VitalsSchema = z.object({
  at: z.string(),
  machine: z.object({ name: z.string(), cpu: z.string(), cores: z.number().int(), memoryBytes: z.number() }),
  /** Percent, 0 to 100. */
  cpu: z.number(),
  memory: z.number(),
  disk: z.number(),
  /** °C; null where the system doesn't report it (most Apple silicon Macs, without extra tools). */
  temperature: z.number().nullable(),
  uptimeSeconds: z.number(),
  /** CPU of the last few minutes, oldest first, for the uptime sparkline. */
  cpuHistory: z.array(z.number()).max(120),
  tailscale: z.enum(['missing', 'off', 'on', 'serving']),
  ollama: z.object({ state: z.enum(['missing', 'stopped', 'running']), models: z.array(z.string()).max(20) }),
  /** Paired devices connected right now (Host mode). */
  devicesOnline: z.number().int().nullable()
})
export type Vitals = z.infer<typeof VitalsSchema>

/** How often vitals are sampled while someone watches. */
export const VITALS_INTERVAL_MS = 5000
/** A watch lasts this long unless renewed: a client that goes away stops the sampling on its own. */
export const VITALS_LEASE_MS = 20_000
