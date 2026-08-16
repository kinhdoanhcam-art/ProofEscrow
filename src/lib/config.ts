export const EXPLORER_BASE =
  import.meta.env.VITE_EXPLORER_BASE ||
  'https://explorer-studio.genlayer.com'

export const DEFAULT_CONTRACT_ADDRESS =
  (import.meta.env.VITE_DEFAULT_CONTRACT_ADDRESS ||
    '0xdD4ecd08d0F23E504b2Bdd6bD1150a5d3C630436') as `0x${string}` | ''

export const LAST_CONTRACT_KEY = 'proofEscrow:lastContract'
