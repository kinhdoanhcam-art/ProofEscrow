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
      return 'Your wallet does not support the GenLayer snap.'
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
