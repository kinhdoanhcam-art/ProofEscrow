export const EXPLORER_BASE =
  import.meta.env.VITE_EXPLORER_BASE ||
  'https://explorer-studio.genlayer.com'

export const DEFAULT_CONTRACT_ADDRESS =
  (import.meta.env.VITE_DEFAULT_CONTRACT_ADDRESS ||
    '0x3ADEDD82008Fd54a0eB9DAA9477743B2b8851008') as `0x${string}` | ''

export const LAST_CONTRACT_KEY = 'proofEscrow:lastContract'
