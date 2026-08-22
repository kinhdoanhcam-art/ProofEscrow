/** EIP-1193 error code, including the nested shapes providers use. */
export function errorCode(error: unknown, depth = 0): number | undefined {
  if (!error || typeof error !== 'object' || depth > 4) return undefined

  const value = error as Record<string, unknown>
  const direct = Number(value.code)
  if (Number.isFinite(direct)) return direct

  for (const key of ['data', 'cause', 'error', 'originalError'] as const) {
    const nested: unknown = value[key]
    if (nested && nested !== error) {
      const found = errorCode(nested, depth + 1)
      if (found !== undefined) return found
    }
  }

  return undefined
}

export function normalizeError(error: unknown): string {
  if (typeof error === 'string') return error

  if (error instanceof Error) {
    return error.message || 'An unexpected error occurred.'
  }

  if (error && typeof error === 'object') {
    const value = error as Record<string, unknown>
    const code = typeof value.code === 'number' ? value.code : Number(value.code)

    if (code === 4001) {
      return 'You rejected the request in your wallet.'
    }

    if (code === -32601) {
      // The GenLayer Snap is optional for this app, so this can only ever be
      // shown as a note — never as a reason a connection failed.
      return 'Your wallet does not support the optional GenLayer Snap. ProofEscrow works without it.'
    }

    if (code === -32002) {
      return 'MetaMask already has a pending request. Open the extension and finish it first.'
    }

    if (code === 4902) {
      return 'GenLayer Studio is not added to your wallet yet.'
    }

    if (typeof value.message === 'string' && value.message.trim()) {
      return value.message
    }

    const data = value.data
    if (data && typeof data === 'object') {
      const dataMessage = (data as Record<string, unknown>).message
      if (typeof dataMessage === 'string' && dataMessage.trim()) {
        return dataMessage
      }
    }

    try {
      const serialized = JSON.stringify(error)
      if (serialized && serialized !== '{}') return serialized
    } catch {
      // Fall through to the generic message.
    }
  }

  return 'An unexpected wallet or RPC error occurred.'
}
