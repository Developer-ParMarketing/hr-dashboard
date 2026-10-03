import axios from 'axios'

export function readConfirmPayload(
  err: unknown,
): { warnings?: string[]; flags?: string[] } | null {
  if (!axios.isAxiosError(err) || err.response?.status !== 409) return null
  const data = err.response.data
  if (!data || typeof data !== 'object') return null
  const row = data as { warnings?: unknown; flags?: unknown }
  const warnings = Array.isArray(row.warnings)
    ? row.warnings.filter((x): x is string => typeof x === 'string')
    : undefined
  const flags = Array.isArray(row.flags)
    ? row.flags.filter((x): x is string => typeof x === 'string')
    : undefined
  if ((!warnings || warnings.length === 0) && (!flags || flags.length === 0)) return null
  return { warnings, flags }
}

export function formatConfirmLines(lines: string[]): string {
  return lines.map((l) => `• ${l}`).join('\n')
}
