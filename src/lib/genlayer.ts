import { createClient } from 'genlayer-js'
import { studionet } from 'genlayer-js/chains'
import { ExecutionResult, TransactionStatus } from 'genlayer-js/types'

import contractSource from '../../contracts/ProofEscrow.py?raw'
import { errorCode, normalizeError } from './errors'

export type Address = `0x${string}`

export type JobSummary = {
  title: string
  client: string
  worker: string
  status: string
  spec_hash: string
  evidence_url: string
  attempt_count: string
  max_attempts: string
  submitted_at: string
  snapshot_committed_at: string
  resolved_at: string
}

export type Financials = {
  reward_wei: string
  pool_wei: string
  reserved_wei: string
  pending_payout_wei: string
}

export type JobState = {
  summary: JobSummary
  financials: Financials
  specification: string
  reviewedSnapshot: string
  verdictReason: string
  failedRequirements: string
}

export class SubmittedButUnconfirmedError extends Error {
  hash: Address

  constructor(hash: Address, message: string) {
    super(message)
    this.name = 'SubmittedButUnconfirmedError'
    this.hash = hash
  }
}

const readClient = createClient({
  chain: studionet,
})

const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms))

async function retry<T>(
  fn: () => Promise<T>,
  attempts = 6,
  baseDelayMs = 900,
): Promise<T> {
  let lastError: unknown

  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn()
    } catch (error) {
      lastError = error

      if (i < attempts - 1) {
        const backoff = Math.min(baseDelayMs * 2 ** i, 8000)
        const jitter = Math.floor(Math.random() * 250)
        await sleep(backoff + jitter)
      }
    }
  }

  throw lastError
}

async function waitForReceiptResilient(params: {
  hash: Address
  status: TransactionStatus
  fullTransaction?: boolean
  rounds?: number
}) {
  let lastError: unknown
  const rounds = params.rounds ?? 6

  for (let i = 0; i < rounds; i += 1) {
    try {
      return await readClient.waitForTransactionReceipt({
        hash: params.hash,
        status: params.status,
        fullTransaction: params.fullTransaction ?? false,
        // Keep each SDK polling window bounded. If the RPC transport fails,
        // the outer loop retries with backoff without ever resubmitting tx.
        retries: i < 2 ? 30 : 18,
      } as any)
    } catch (error) {
      lastError = error

      if (i < rounds - 1) {
        await sleep(Math.min(1400 * 2 ** i, 10000))
      }
    }
  }

  throw lastError
}

export async function getAuthorizedAccount(): Promise<Address | null> {
  if (!window.ethereum) return null

  const accounts = (await window.ethereum.request({
    method: 'eth_accounts',
  })) as string[]

  return accounts[0] ? (accounts[0] as Address) : null
}

export const STUDIO_CHAIN_ID = 61999
export const STUDIO_CHAIN_ID_HEX = '0xf22f'

/**
 * What MetaMask needs to add the network. The RPC is the direct Studio endpoint
 * because the wallet dials it itself.
 */
const STUDIO_CHAIN_PARAMS = {
  chainId: STUDIO_CHAIN_ID_HEX,
  chainName: 'Genlayer Studio Network',
  rpcUrls: ['https://studio.genlayer.com/api'],
  nativeCurrency: { name: 'GEN Token', symbol: 'GEN', decimals: 18 },
  blockExplorerUrls: ['https://explorer-studio.genlayer.com'],
}

/**
 * Put the wallet on GenLayer Studio.
 *
 * Done here instead of through the SDK's connect() so that each prompt has its
 * own error, and so the optional GenLayer Snap can never be part of the path.
 */
export async function ensureStudioChain(): Promise<void> {
  if (!window.ethereum) {
    throw new Error('MetaMask was not found.')
  }

  const current = (await window.ethereum.request({
    method: 'eth_chainId',
  })) as string

  if (typeof current === 'string' && current.toLowerCase() === STUDIO_CHAIN_ID_HEX) {
    return
  }

  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: STUDIO_CHAIN_ID_HEX }],
    })
    return
  } catch (switchError) {
    // 4902 = the wallet does not know this chain yet. Everything else is a real
    // failure (rejection, pending request) and must surface to the caller.
    if (errorCode(switchError) !== 4902) throw switchError
  }

  await window.ethereum.request({
    method: 'wallet_addEthereumChain',
    params: [STUDIO_CHAIN_PARAMS],
  })

  await window.ethereum.request({
    method: 'wallet_switchEthereumChain',
    params: [{ chainId: STUDIO_CHAIN_ID_HEX }],
  })
}

export type ConnectResult = {
  address: Address
  /** Non-fatal: connected, but something optional did not complete. */
  warning?: string
}

/**
 * Connect the wallet.
 *
 * The account is authoritative the moment eth_requestAccounts resolves, so it is
 * returned even when a later step fails. Previously this returned only after the
 * SDK's connect() had also added the network, switched to it, called
 * wallet_getSnaps and installed the GenLayer Snap — none of it guarded. A wallet
 * without Snap support threw at wallet_getSnaps, so the whole connection failed
 * with "Your wallet does not support the GenLayer snap."
 *
 * The Snap is not required here: in genlayer-js the snap APIs are used only
 * inside connect() and the metamaskClient() diagnostic. Reads use HTTP and writes
 * use plain eth_sendTransaction. So it is attempted best-effort, and never blocks.
 */
export async function connectWallet(): Promise<ConnectResult> {
  if (!window.ethereum) {
    throw new Error('MetaMask was not found.')
  }

  const accounts = (await window.ethereum.request({
    method: 'eth_requestAccounts',
  })) as string[]

  if (!accounts[0]) {
    throw new Error('No wallet account was returned.')
  }

  const address = accounts[0] as Address
  let warning: string | undefined

  try {
    await ensureStudioChain()
  } catch (chainError) {
    console.warn('[ProofEscrow] network switch did not complete', chainError)
    warning = `Connected, but MetaMask is not on GenLayer Studio yet: ${normalizeError(chainError)}`
  }

  // Optional Snap install. Skipped when the chain step already failed, because
  // the SDK repeats the add/switch prompts and re-prompting someone who just
  // declined is worse than not offering the Snap at all.
  if (warning === undefined) {
    try {
      const client = createClient({
        chain: studionet,
        account: address,
        provider: window.ethereum,
      })
      // The ONLY place client.connect() is still called. Its value here is the
      // optional Snap install; the chain is already handled above.
      await client.connect()
    } catch (snapError) {
      console.warn('[ProofEscrow] optional GenLayer Snap step skipped', snapError)
    }
  }

  return warning === undefined ? { address } : { address, warning }
}

function createWriteClient(account: Address) {
  if (!window.ethereum) {
    throw new Error('MetaMask was not found.')
  }

  return createClient({
    chain: studionet,
    account,
    provider: window.ethereum,
  })
}

async function readString(
  address: Address,
  functionName: string,
): Promise<string> {
  const result = await retry(() =>
    readClient.readContract({
      address,
      functionName,
      args: [],
      stateStatus: 'accepted',
    } as any),
  )

  return typeof result === 'string' ? result : String(result ?? '')
}

export async function readJob(address: Address): Promise<JobState> {
  // StudioNet can intermittently fail when six RPC reads are fired at once.
  // Read sequentially with a tiny pause so one flaky transport response does
  // not make every card on the page look stale.
  const summaryRaw = await readString(address, 'get_job_summary')
  await sleep(120)
  const financialsRaw = await readString(address, 'get_financials')
  await sleep(120)
  const specification = await readString(address, 'get_specification')
  await sleep(120)
  const reviewedSnapshot = await readString(address, 'get_reviewed_snapshot')
  await sleep(120)
  const verdictReason = await readString(address, 'get_verdict_reason')
  await sleep(120)
  const failedRequirements = await readString(address, 'get_failed_requirements')

  return {
    summary: JSON.parse(summaryRaw) as JobSummary,
    financials: JSON.parse(financialsRaw) as Financials,
    specification,
    reviewedSnapshot,
    verdictReason,
    failedRequirements,
  }
}

function contractAddressFromReceipt(receipt: any): Address {
  const address =
    receipt?.data?.contract_address ??
    receipt?.data?.contractAddress ??
    receipt?.txDataDecoded?.contractAddress ??
    receipt?.contractAddress

  if (!address) {
    throw new Error(
      'Deployment reached consensus but the contract address was not present in the receipt.',
    )
  }

  return address as Address
}

export async function deployEscrow(params: {
  account: Address
  title: string
  specification: string
  worker: Address
  rewardWei: bigint
  maxAttempts: number
  onHash?: (hash: Address) => void
  onStage?: (stage: 'submitting' | 'waiting' | 'confirmed') => void
}): Promise<{ address: Address; hash: Address }> {
  const client = createWriteClient(params.account)
  params.onStage?.('submitting')
  // Guarantees the wallet is on GenLayer Studio. Deliberately NOT client.connect():
  // that also runs the optional Snap flow, which used to fail the whole action on
  // wallets without Snap support.
  await ensureStudioChain()

  const hash = (await client.deployContract({
    code: new TextEncoder().encode(contractSource),
    args: [
      params.title,
      params.specification,
      params.worker,
      params.rewardWei,
      BigInt(params.maxAttempts),
    ],
  })) as Address

  params.onHash?.(hash)
  params.onStage?.('waiting')

  try {
    const receipt = await waitForReceiptResilient({
      hash,
      status: TransactionStatus.ACCEPTED,
      fullTransaction: true,
      rounds: 4,
    })

    if (
      receipt.txExecutionResultName &&
      receipt.txExecutionResultName === ExecutionResult.FINISHED_WITH_ERROR
    ) {
      throw new Error('Contract deployment was accepted with an execution error.')
    }

    const address = contractAddressFromReceipt(receipt)
    params.onStage?.('confirmed')

    return {
      address,
      hash,
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('execution error')) {
      throw error
    }

    throw new SubmittedButUnconfirmedError(
      hash,
      'The deployment transaction was submitted, but RPC monitoring could not recover the contract address yet. Do not deploy again. Open the transaction in Explorer, then paste the deployed contract address into the recovery field.',
    )
  }
}

export async function writeEscrow(params: {
  account: Address
  address: Address
  functionName: string
  args?: unknown[]
  value?: bigint
  waitForFinalized?: boolean
  onHash?: (hash: Address) => void
}): Promise<Address> {
  const client = createWriteClient(params.account)
  // Guarantees the wallet is on GenLayer Studio. Deliberately NOT client.connect():
  // that also runs the optional Snap flow, which used to fail the whole action on
  // wallets without Snap support.
  await ensureStudioChain()

  let hash: Address

  try {
    hash = (await client.writeContract({
      address: params.address,
      functionName: params.functionName,
      args: (params.args || []) as any[],
      value: params.value ?? 0n,
    })) as Address
  } catch (error) {
    throw error
  }

  params.onHash?.(hash)

  try {
    const receipt = await waitForReceiptResilient({
      hash,
      status: params.waitForFinalized
        ? TransactionStatus.FINALIZED
        : TransactionStatus.ACCEPTED,
      fullTransaction: false,
      rounds: params.waitForFinalized ? 7 : 6,
    })

    if (
      receipt.txExecutionResultName &&
      receipt.txExecutionResultName === ExecutionResult.FINISHED_WITH_ERROR
    ) {
      throw new Error(
        `${params.functionName} reached consensus but contract execution failed.`,
      )
    }

    return hash
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('contract execution failed')
    ) {
      throw error
    }

    throw new SubmittedButUnconfirmedError(
      hash,
      `Transaction ${hash} was submitted, but RPC monitoring could not confirm its status. Do not submit the action again until you check the transaction.`,
    )
  }
}