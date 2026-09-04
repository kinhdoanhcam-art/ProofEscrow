export const EXPLORER_BASE =
  import.meta.env.VITE_EXPLORER_BASE ||
  'https://explorer-studio.genlayer.com'

const FALLBACK_CONTRACT_ADDRESS =
  '0x3ADEDD82008Fd54a0eB9DAA9477743B2b8851008' as const

const HISTORICAL_V1_ADDRESSES = new Set([
  '0xdD4ecd08d0F23E504b2Bdd6bD1150a5d3C630436'.toLowerCase(),
  '0x9d829aF09870Fc4597983E4b0e6AFBBB0ce9B396'.toLowerCase(),
])

const configuredDefault = (import.meta.env.VITE_DEFAULT_CONTRACT_ADDRESS || '').trim()
const configuredDefaultIsSafe =
  /^0x[a-fA-F0-9]{40}$/.test(configuredDefault) &&
  !HISTORICAL_V1_ADDRESSES.has(configuredDefault.toLowerCase())

// Never let a stale Vercel/browser-era V1 environment value become the production default.
// A valid non-historical V2 address may still override the fallback intentionally.
export const DEFAULT_CONTRACT_ADDRESS = (
  configuredDefaultIsSafe ? configuredDefault : FALLBACK_CONTRACT_ADDRESS
) as `0x${string}`

export const LAST_CONTRACT_KEY = 'proofEscrow:lastContract'
