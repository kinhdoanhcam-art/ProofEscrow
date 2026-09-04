import { useEffect, useMemo, useRef, useState } from 'react'
import { formatEther, isAddress, parseEther } from 'viem'

import {
  connectWallet,
  deployEscrow,
  getAuthorizedAccount,
  readJob,
  SubmittedButUnconfirmedError,
  writeEscrow,
  type Address,
  type JobState,
} from './lib/genlayer'
import { DEFAULT_CONTRACT_ADDRESS, EXPLORER_BASE, LAST_CONTRACT_KEY } from './lib/config'
import { normalizeError } from './lib/errors'

type Mode = 'landing' | 'create' | 'dashboard'

const modeFromHash = (): Mode => {
  const route = window.location.hash.replace('#/', '').replace('#', '')
  if (route === 'create') return 'create'
  if (route === 'dashboard') return 'dashboard'
  return 'landing'
}

type RecentJob = {
  address: Address
  title: string
  status: string
}

const MAX_TITLE_LENGTH = 160
const MAX_SPEC_LENGTH = 2000
const MAX_URL_LENGTH = 1000
const RECENT_JOBS_KEY = 'proofEscrow:recentJobs'

const short = (value: string) =>
  value ? `${value.slice(0, 6)}...${value.slice(-4)}` : '—'

const gen = (wei: string) => {
  try {
    return `${Number(formatEther(BigInt(wei))).toLocaleString()} GEN`
  } catch {
    return '0 GEN'
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const localDateTime = (hoursFromNow: number) => {
  const date = new Date(Date.now() + hoursFromNow * 60 * 60 * 1000)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

const toUnixSeconds = (value: string) => {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) throw new Error('Enter a valid deadline.')
  return Math.floor(parsed.getTime() / 1000)
}

const unixToIso = (value: string) => {
  const seconds = Number(value)
  return Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : ''
}

const formatDate = (value: string) => {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString()
}

const remaining = (value: string) => {
  const target = new Date(value).getTime()
  if (!Number.isFinite(target)) return '—'
  const delta = target - Date.now()
  if (delta <= 0) return 'Deadline passed'
  const hours = Math.floor(delta / 3_600_000)
  const days = Math.floor(hours / 24)
  const remHours = hours % 24
  if (days > 0) return `${days}d ${remHours}h remaining`
  const mins = Math.max(1, Math.floor(delta / 60_000))
  return hours > 0 ? `${hours}h remaining` : `${mins}m remaining`
}

const EXPECTED_STATUSES: Record<string, string[]> = {
  fund: ['FUNDED'],
  submit_deliverable: ['SUBMITTED'],
  commit_reviewed_snapshot: ['SNAPSHOT_COMMITTED'],
  adjudicate: ['ACCEPTED_RESERVED', 'REJECTED'],
  withdraw: ['PAID'],
  release_reserved_payout: ['PAID'],
  refund: ['REFUNDED'],
  cancel_after_deadline: ['CANCELLED_TIMEOUT'],
}

const STATUS_LABEL: Record<string, string> = {
  OPEN: 'Open',
  FUNDED: 'Funded',
  SUBMITTED: 'Submitted',
  SNAPSHOT_COMMITTED: 'Snapshot ready',
  ACCEPTED_RESERVED: 'Accepted · payout reserved',
  REJECTED: 'Rejected',
  PAID: 'Paid',
  REFUNDED: 'Refunded',
  CANCELLED_TIMEOUT: 'Cancelled · timeout',
  MUTUALLY_CLOSED: 'Mutually closed',
}

const STATUS_COPY: Record<string, string> = {
  OPEN: 'The agreement exists but no GEN is locked yet.',
  FUNDED: 'GEN is locked. The Worker must submit before the submission deadline.',
  SUBMITTED: 'Evidence is submitted. The factual snapshot must be committed before the adjudication deadline.',
  SNAPSHOT_COMMITTED: 'The reviewed snapshot is on-chain. Adjudicate before the final deadline.',
  ACCEPTED_RESERVED: 'The Worker earned the reward. Anyone may safely release the fixed payout to the Worker.',
  REJECTED: 'The Client may refund now, or the Worker may resubmit before the adjudication deadline if attempts remain.',
  PAID: 'Final settlement completed to the Worker.',
  REFUNDED: 'Final settlement returned to the Client after rejection.',
  CANCELLED_TIMEOUT: 'The workflow missed a locked deadline and the pooled GEN was returned to the Client.',
  MUTUALLY_CLOSED: 'Client and Worker both approved closure; pooled GEN was returned to the Client.',
}

const TERMINAL = new Set(['PAID', 'REFUNDED', 'CANCELLED_TIMEOUT', 'MUTUALLY_CLOSED'])

const formatElapsed = (seconds: number) => {
  const mins = Math.floor(seconds / 60).toString().padStart(2, '0')
  const secs = (seconds % 60).toString().padStart(2, '0')
  return `${mins}:${secs}`
}

function AddressValue({ value }: { value: string }) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      // Clipboard is progressive enhancement only.
    }
  }

  return (
    <span className="address-value" title={value}>
      <code>{short(value)}</code>
      <button className="copy" onClick={copy} aria-label={`Copy ${value}`}>⧉</button>
    </span>
  )
}

export default function App() {
  const [account, setAccount] = useState<Address | null>(null)
  const [mode, setMode] = useState<Mode>(() => modeFromHash())
  const [contractAddress, setContractAddress] = useState('')
  const [loadAddress, setLoadAddress] = useState('')
  const [job, setJob] = useState<JobState | null>(null)
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [txHash, setTxHash] = useState('')
  const [evidenceUrl, setEvidenceUrl] = useState('')
  const [recentJobs, setRecentJobs] = useState<RecentJob[]>([])
  const [recoveryAddress, setRecoveryAddress] = useState('')
  const [deployStage, setDeployStage] = useState('')
  const [deployElapsed, setDeployElapsed] = useState(0)

  const [title, setTitle] = useState('Milestone Delivery Escrow')
  const [specification, setSpecification] = useState(
    'The Worker must provide a public deliverable that satisfies every material requirement described here. Missing or unverifiable requirements must be rejected.',
  )
  const [worker, setWorker] = useState('')
  const [rewardGen, setRewardGen] = useState('1')
  const [maxAttempts, setMaxAttempts] = useState('2')
  const [submissionDeadlineLocal, setSubmissionDeadlineLocal] = useState(() => localDateTime(72))
  const [adjudicationDeadlineLocal, setAdjudicationDeadlineLocal] = useState(() => localDateTime(168))

  const operationLock = useRef(false)

  function navigate(next: Mode) {
    setMode(next)
    const route = next === 'landing' ? '#/' : `#/${next}`
    if (window.location.hash !== route) window.location.hash = route
  }

  const address = useMemo(
    () => (isAddress(contractAddress) ? (contractAddress as Address) : null),
    [contractAddress],
  )

  const isClient = !!account && !!job && account.toLowerCase() === job.summary.client.toLowerCase()
  const isWorker = !!account && !!job && account.toLowerCase() === job.summary.worker.toLowerCase()
  const status = job?.summary.status || ''
  const role = !account || !job ? 'OBSERVER' : isClient ? 'CLIENT' : isWorker ? 'WORKER' : 'OBSERVER'

  const submissionPassed = !!job && Math.floor(Date.now() / 1000) >= Number(job.summary.submission_deadline_unix)
  const adjudicationPassed = !!job && Math.floor(Date.now() / 1000) >= Number(job.summary.adjudication_deadline_unix)

  const submissionDeadlineState = (() => {
    if (!job) return { className: '', copy: '—' }
    if (status === 'CANCELLED_TIMEOUT' && !job.summary.submitted_at) {
      return { className: 'expired', copy: 'Submission deadline elapsed · timeout exit triggered' }
    }
    if (status === 'MUTUALLY_CLOSED') {
      return { className: 'complete', copy: 'Escrow resolved by mutual close' }
    }
    if (['SUBMITTED', 'SNAPSHOT_COMMITTED', 'ACCEPTED_RESERVED', 'REJECTED', 'PAID', 'REFUNDED', 'CANCELLED_TIMEOUT'].includes(status)) {
      return { className: 'complete', copy: 'Submission completed' }
    }
    return {
      className: submissionPassed ? 'expired' : '',
      copy: remaining(unixToIso(job.summary.submission_deadline_unix)),
    }
  })()

  const adjudicationDeadlineState = (() => {
    if (!job) return { className: '', copy: '—' }
    if (status === 'CANCELLED_TIMEOUT' && job.summary.submitted_at) {
      return { className: 'expired', copy: 'Adjudication deadline elapsed · timeout exit triggered' }
    }
    if (status === 'MUTUALLY_CLOSED') {
      return { className: 'complete', copy: 'Escrow resolved by mutual close' }
    }
    if (status === 'PAID') {
      return { className: 'complete', copy: 'Adjudication completed · payout released' }
    }
    if (status === 'REFUNDED') {
      return { className: 'complete', copy: 'Adjudication completed · Client refunded' }
    }
    if (status === 'ACCEPTED_RESERVED') {
      return { className: 'complete', copy: 'Adjudication completed · payout reserved' }
    }
    return {
      className: adjudicationPassed ? 'expired' : '',
      copy: remaining(unixToIso(job.summary.adjudication_deadline_unix)),
    }
  })()

  const timeoutAvailable = !!job && (
    (status === 'FUNDED' && submissionPassed) ||
    (['SUBMITTED', 'SNAPSHOT_COMMITTED', 'REJECTED'].includes(status) && adjudicationPassed)
  )
  const mutualCloseAvailable = !!job && ['FUNDED', 'SUBMITTED', 'SNAPSHOT_COMMITTED', 'REJECTED'].includes(status)
  const currentWalletApproved = !!job && (isClient ? job.summary.client_close_approved : isWorker ? job.summary.worker_close_approved : false)

  function saveRecentJob(next: RecentJob) {
    setRecentJobs((current) => {
      const deduped = current.filter((item) => item.address.toLowerCase() !== next.address.toLowerCase())
      const updated = [next, ...deduped].slice(0, 8)
      localStorage.setItem(RECENT_JOBS_KEY, JSON.stringify(updated))
      return updated
    })
  }

  useEffect(() => {
    void (async () => {
      const restored = await getAuthorizedAccount()
      if (restored) setAccount(restored)

      const saved = DEFAULT_CONTRACT_ADDRESS || localStorage.getItem(LAST_CONTRACT_KEY) || ''
      if (saved && isAddress(saved)) {
        setContractAddress(saved)
        setLoadAddress(saved)
      }

      try {
        const storedJobs = JSON.parse(localStorage.getItem(RECENT_JOBS_KEY) || '[]') as RecentJob[]
        setRecentJobs(Array.isArray(storedJobs) ? storedJobs : [])
      } catch {
        setRecentJobs([])
      }
    })()
  }, [])

  useEffect(() => {
    const onHash = () => setMode(modeFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    if (!window.ethereum?.on) return
    const handleAccountsChanged = (accounts: string[]) => {
      const next = accounts[0] ? (accounts[0] as Address) : null
      setAccount(next)
      setError('')
      setNotice(next ? `Wallet changed to ${short(next)}` : 'Wallet disconnected.')
    }
    window.ethereum.on('accountsChanged', handleAccountsChanged)
    return () => window.ethereum?.removeListener?.('accountsChanged', handleAccountsChanged)
  }, [])

  useEffect(() => {
    if (!notice || notice.toLowerCase().includes('submitted')) return
    const timer = window.setTimeout(() => setNotice(''), 6000)
    return () => window.clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    if (busy !== 'Deploying escrow' || deployStage !== 'waiting') {
      if (busy !== 'Deploying escrow') setDeployElapsed(0)
      return
    }
    let cancelled = false
    const startedAt = Date.now()
    const tick = () => {
      if (cancelled) return
      setDeployElapsed(Math.floor((Date.now() - startedAt) / 1000))
      window.setTimeout(tick, 1000)
    }
    tick()
    return () => { cancelled = true }
  }, [busy, deployStage])

  useEffect(() => {
    if (!address) {
      setJob(null)
      return
    }
    void refresh(address, { quiet: true })
  }, [address])

  async function refresh(
    target = address,
    options: { quiet?: boolean; clearOnFailure?: boolean } = {},
  ): Promise<JobState | null> {
    if (!target) return null
    try {
      const next = await readJob(target)
      setJob(next)
      saveRecentJob({ address: target, title: next.summary.title || 'Loaded escrow', status: next.summary.status })
      if (!options.quiet) setError('')
      return next
    } catch (err) {
      console.error('[ProofEscrow] raw refresh error:', err)
      if (options.clearOnFailure) setJob(null)
      if (!options.quiet) setError(normalizeError(err))
      return null
    }
  }

  async function pollForExpectedState(target: Address, expected: string[], attempts = 9) {
    for (let i = 0; i < attempts; i += 1) {
      const next = await refresh(target, { quiet: true })
      if (next && expected.includes(next.summary.status)) {
        setError('')
        return next
      }
      if (i < attempts - 1) await sleep(Math.min(1200 * (i + 1), 7000))
    }
    return null
  }

  async function guarded(label: string, action: () => Promise<void>) {
    if (operationLock.current) return
    operationLock.current = true
    setBusy(label)
    setError('')
    setNotice('')
    setTxHash('')
    try {
      await action()
    } catch (err) {
      console.error('[ProofEscrow] raw error:', err)
      if (err instanceof SubmittedButUnconfirmedError) {
        setTxHash(err.hash)
        setNotice(err.message)
        if (label === 'Deploying escrow') {
          setDeployStage('recovery')
          navigate('create')
        }
      } else {
        setError(normalizeError(err))
      }
    } finally {
      operationLock.current = false
      setBusy('')
    }
  }

  async function handleConnect() {
    await guarded('Connecting wallet', async () => {
      const { address: next, warning } = await connectWallet()
      setAccount(next)
      setNotice(warning ? `Connected ${short(next)} — ${warning}` : `Connected ${short(next)}`)
    })
  }

  async function handleLoad() {
    if (!isAddress(loadAddress)) {
      setError('Enter a valid GenLayer contract address.')
      return
    }
    const target = loadAddress as Address
    setJob(null)
    setError('')
    setContractAddress(target)
    localStorage.setItem(LAST_CONTRACT_KEY, target)
    navigate('dashboard')

    const loaded = await pollForExpectedState(target, [
      'OPEN', 'FUNDED', 'SUBMITTED', 'SNAPSHOT_COMMITTED', 'ACCEPTED_RESERVED',
      'REJECTED', 'PAID', 'REFUNDED', 'CANCELLED_TIMEOUT', 'MUTUALLY_CLOSED',
    ], 6)
    if (!loaded) {
      setNotice('Escrow address loaded, but StudioNet state is still syncing. Use Refresh; do not redeploy.')
      saveRecentJob({ address: target, title: 'Loaded escrow', status: 'SYNCING' })
    }
  }

  async function handleCreate() {
    if (!account) return setError('Connect the Client wallet first.')
    if (!isAddress(worker)) return setError('Worker address is invalid.')

    const cleanTitle = title.trim()
    const cleanSpecification = specification.trim()
    if (!cleanTitle || !cleanSpecification) return setError('Title and specification are required.')
    if (cleanTitle.length > MAX_TITLE_LENGTH) return setError(`Job title must be ${MAX_TITLE_LENGTH} characters or fewer.`)
    if (cleanSpecification.length > MAX_SPEC_LENGTH) return setError(`Specification must be ${MAX_SPEC_LENGTH} characters or fewer.`)

    const attempts = Number(maxAttempts)
    if (!Number.isInteger(attempts) || attempts < 1 || attempts > 5) return setError('Max attempts must be between 1 and 5.')

    let rewardWei: bigint
    try {
      rewardWei = parseEther(rewardGen)
      if (rewardWei <= 0n) throw new Error()
    } catch {
      return setError('Reward must be a positive GEN amount.')
    }

    let submissionDeadlineUnix: number
    let adjudicationDeadlineUnix: number
    try {
      submissionDeadlineUnix = toUnixSeconds(submissionDeadlineLocal)
      adjudicationDeadlineUnix = toUnixSeconds(adjudicationDeadlineLocal)
    } catch (err) {
      return setError(normalizeError(err))
    }
    const now = Date.now()
    if (submissionDeadlineUnix * 1000 <= now) return setError('Submission deadline must be in the future.')
    if (adjudicationDeadlineUnix <= submissionDeadlineUnix) return setError('Adjudication deadline must be after the submission deadline.')

    setRecoveryAddress('')
    setDeployStage('submitting')

    await guarded('Deploying escrow', async () => {
      const deployed = await deployEscrow({
        account,
        title: cleanTitle,
        specification: cleanSpecification,
        worker: worker as Address,
        rewardWei,
        maxAttempts: attempts,
        submissionDeadlineUnix: BigInt(submissionDeadlineUnix),
        adjudicationDeadlineUnix: BigInt(adjudicationDeadlineUnix),
        onHash: (hash) => setTxHash(hash),
        onStage: (stage) => setDeployStage(stage),
      })
      setJob(null)
      setContractAddress(deployed.address)
      setLoadAddress(deployed.address)
      localStorage.setItem(LAST_CONTRACT_KEY, deployed.address)
      saveRecentJob({ address: deployed.address, title: cleanTitle, status: 'OPEN' })
      navigate('dashboard')
      await pollForExpectedState(deployed.address, ['OPEN'], 8)
      setNotice(`Escrow deployed at ${deployed.address}`)
    })
  }

  async function handleRecoverAddress() {
    if (!isAddress(recoveryAddress)) return setError('Paste a valid deployed contract address from Explorer.')
    const target = recoveryAddress as Address
    setContractAddress(target)
    setLoadAddress(target)
    localStorage.setItem(LAST_CONTRACT_KEY, target)
    saveRecentJob({ address: target, title: title.trim() || 'Recovered escrow', status: 'SYNCING' })
    setDeployStage('confirmed')
    setError('')
    navigate('dashboard')
    await pollForExpectedState(target, ['OPEN'], 8)
  }

  async function runWrite(label: string, functionName: string, args: unknown[] = [], value = 0n, finalized = false) {
    if (!account || !address) return setError('Connect wallet and load an escrow first.')
    const expected = EXPECTED_STATUSES[functionName] || []

    await guarded(label, async () => {
      try {
        await writeEscrow({ account, address, functionName, args, value, waitForFinalized: finalized, onHash: (hash) => setTxHash(hash) })
      } catch (err) {
        if (err instanceof SubmittedButUnconfirmedError) {
          setTxHash(err.hash)
          setNotice('Transaction submitted. RPC confirmation is delayed; checking accepted contract state. Do not submit again.')
          if (expected.length > 0) await pollForExpectedState(address, expected, 10)
          return
        }
        throw err
      }

      if (expected.length > 0) {
        const updated = await pollForExpectedState(address, expected, 8)
        if (updated) {
          setNotice(`${functionName} confirmed on-chain.`)
          return
        }
      } else {
        await refresh(address, { quiet: true })
      }
      setNotice(`${functionName} accepted by the network.`)
    })
  }

  const canSubmit = status === 'FUNDED' || status === 'REJECTED'
  const attemptsRemain = !!job && Number(job.summary.attempt_count) < Number(job.summary.max_attempts)

  return (
    <main className="app-shell">
      <header className="site-header">
        <button className="brand" onClick={() => navigate('landing')}>
          <span className="brand-mark">PE</span>
          <span><strong>ProofEscrow</strong><small>AI-adjudicated work escrow</small></span>
        </button>
        <nav>
          <button className={mode === 'landing' ? 'active' : ''} onClick={() => navigate('landing')}>Overview</button>
          <button className={mode === 'create' ? 'active' : ''} onClick={() => navigate('create')}>Create escrow</button>
          <button className={mode === 'dashboard' ? 'active' : ''} onClick={() => navigate('dashboard')}>Dashboard</button>
        </nav>
        <button className="wallet-button" onClick={handleConnect} disabled={!!busy}>
          {account ? `◆ ${short(account)}` : 'Connect wallet'}
        </button>
      </header>

      {mode === 'landing' && (
        <section className="landing-page page">
          <div className="landing-hero">
            <div>
              <span className="kicker">DEADLINE-SAFE · AI-ADJUDICATED · GENLAYER</span>
              <h1>Work escrow that cannot wait forever.</h1>
              <p>Lock the deliverable, reward, submission deadline, and adjudication deadline in one contract. AI validators judge evidence; deterministic exits prevent funded GEN from being stranded if the workflow stalls.</p>
              <div className="hero-actions">
                <button className="primary" onClick={() => navigate('create')}>Create escrow →</button>
                <button className="secondary" onClick={() => navigate('dashboard')}>Open dashboard</button>
              </div>
            </div>
            <div className="safety-stack">
              <div className="safety-card accent"><span>01</span><strong>Submission deadline</strong><p>If no deliverable arrives in time, either party can trigger a deterministic refund to the Client.</p></div>
              <div className="safety-card"><span>02</span><strong>Adjudication deadline</strong><p>Submitted work must reach a final adjudication before the second locked deadline.</p></div>
              <div className="safety-card"><span>03</span><strong>Mutual close</strong><p>Client and Worker can jointly unwind a funded escrow without waiting for a timeout.</p></div>
            </div>
          </div>

          <div className="feature-grid">
            <article><span className="icon">◇</span><h3>Immutable acceptance spec</h3><p>The specification hash and terms are fixed at contract creation.</p></article>
            <article><span className="icon">✦</span><h3>Two-stage AI review</h3><p>Validators first commit factual evidence, then adjudicate only against that committed snapshot.</p></article>
            <article><span className="icon">↗</span><h3>Deterministic settlement</h3><p>Accepted rewards go only to the Worker; rejection and safety exits return pooled GEN only to the Client.</p></article>
          </div>
        </section>
      )}

      {mode === 'create' && (
        <section className="page create-page">
          <div className="page-heading">
            <div><span className="kicker">NEW AGREEMENT</span><h2>Create a deadline-bound escrow</h2><p>Every field below becomes part of the contract instance. Deadlines are absolute UTC times and cannot be silently extended.</p></div>
          </div>

          <div className="create-layout">
            <section className="panel form-panel">
              <label><span className="label-row"><span>Job title</span><small>{title.length}/{MAX_TITLE_LENGTH}</small></span><input maxLength={MAX_TITLE_LENGTH} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
              <label><span className="label-row"><span>Locked acceptance specification</span><small>{specification.length}/{MAX_SPEC_LENGTH}</small></span><textarea rows={7} maxLength={MAX_SPEC_LENGTH} value={specification} onChange={(e) => setSpecification(e.target.value)} /></label>
              <div className="field-grid two">
                <label>Worker wallet<input placeholder="0x..." value={worker} onChange={(e) => setWorker(e.target.value)} /></label>
                <label>Reward (GEN)<input type="number" min="0" step="0.1" value={rewardGen} onChange={(e) => setRewardGen(e.target.value)} /></label>
              </div>
              <div className="field-grid two">
                <label>Submission deadline<input type="datetime-local" value={submissionDeadlineLocal} onChange={(e) => setSubmissionDeadlineLocal(e.target.value)} /></label>
                <label>Adjudication deadline<input type="datetime-local" value={adjudicationDeadlineLocal} onChange={(e) => setAdjudicationDeadlineLocal(e.target.value)} /></label>
              </div>
              <label>Max submission attempts<input type="number" min="1" max="5" value={maxAttempts} onChange={(e) => setMaxAttempts(e.target.value)} /></label>
              <button className="primary wide" onClick={handleCreate} disabled={!!busy}>{busy === 'Deploying escrow' ? 'Deploying…' : 'Deploy escrow contract'}</button>

              {busy === 'Deploying escrow' && <div className="inline-note">{deployStage === 'submitting' ? 'Confirm deployment in MetaMask.' : deployStage === 'waiting' ? `Waiting for accepted consensus · ${formatElapsed(deployElapsed)}` : 'Contract address confirmed.'}</div>}
              {deployStage === 'recovery' && txHash && (
                <div className="recovery-box"><strong>Deployment submitted; address recovery needed.</strong><p>Do not deploy again. Open the transaction, copy the new contract address, then recover it here.</p><a href={`${EXPLORER_BASE}/transactions/${txHash}`} target="_blank" rel="noreferrer">Open transaction {short(txHash)} ↗</a><div className="recovery-row"><input placeholder="0x deployed contract" value={recoveryAddress} onChange={(e) => setRecoveryAddress(e.target.value)} /><button className="secondary" onClick={handleRecoverAddress}>Recover</button></div></div>
              )}
            </section>

            <aside className="panel safety-summary">
              <span className="kicker">FUNDS SAFETY</span><h3>Two deadline exits + mutual close</h3>
              <div className="rule"><span>Submission</span><strong>{submissionDeadlineLocal ? formatDate(new Date(toUnixSeconds(submissionDeadlineLocal) * 1000).toISOString()) : '—'}</strong><p>If FUNDED with no submission when this passes, Client or Worker may trigger timeout cancellation.</p></div>
              <div className="rule"><span>Adjudication</span><strong>{adjudicationDeadlineLocal ? formatDate(new Date(toUnixSeconds(adjudicationDeadlineLocal) * 1000).toISOString()) : '—'}</strong><p>If submitted work has not reached final settlement by this time, either party may return the pool to the Client.</p></div>
              <div className="rule"><span>Mutual close</span><strong>2-of-2 approval</strong><p>Client and Worker may both approve closure while funds remain pooled.</p></div>
            </aside>
          </div>
        </section>
      )}

      {mode === 'dashboard' && (
        <section className="page dashboard-page">
          <div className="load-panel panel">
            <div><span className="kicker">ESCROW INSTANCE</span><h2>Open a contract dashboard</h2></div>
            <div className="load-row"><input placeholder="0x escrow contract" value={loadAddress} onChange={(e) => setLoadAddress(e.target.value)} /><button className="secondary" onClick={handleLoad}>Open</button></div>
          </div>

          {recentJobs.length > 0 && (
            <div className="recent-strip">
              {recentJobs.map((item) => <button key={item.address} onClick={() => { setLoadAddress(item.address); setContractAddress(item.address); localStorage.setItem(LAST_CONTRACT_KEY, item.address) }}><span><strong>{item.title}</strong><small>{short(item.address)}</small></span><em>{STATUS_LABEL[item.status] || item.status}</em></button>)}
            </div>
          )}

          {job && address ? (
            <>
              <section className="dashboard-hero panel">
                <div><span className={`status-pill ${status.toLowerCase()}`}>{STATUS_LABEL[status] || status}</span><span className="role-pill">{role}</span><h2>{job.summary.title}</h2><p>{STATUS_COPY[status]}</p></div>
                <div className="reward-block"><span>Reward</span><strong>{gen(job.financials.reward_wei)}</strong><a href={`${EXPLORER_BASE}/address/${address}`} target="_blank" rel="noreferrer">{short(address)} ↗</a></div>
              </section>

              <div className="metric-grid">
                <article className="metric panel"><span>Pool</span><strong>{gen(job.financials.pool_wei)}</strong></article>
                <article className="metric panel"><span>Reserved</span><strong>{gen(job.financials.reserved_wei)}</strong></article>
                <article className="metric panel"><span>Pending payout</span><strong>{gen(job.financials.pending_payout_wei)}</strong></article>
                <article className="metric panel"><span>Attempts</span><strong>{job.summary.attempt_count}/{job.summary.max_attempts}</strong></article>
              </div>

              <div className="dashboard-grid">
                <section className="panel">
                  <div className="section-head"><div><span className="kicker">AGREEMENT</span><h3>Locked parties & specification</h3></div></div>
                  <div className="detail-row"><span>Client</span><AddressValue value={job.summary.client} /></div>
                  <div className="detail-row"><span>Worker</span><AddressValue value={job.summary.worker} /></div>
                  <div className="detail-row"><span>Spec hash</span><code title={job.summary.spec_hash}>{short(job.summary.spec_hash)}</code></div>
                  <div className="spec-box">{job.specification}</div>
                </section>

                <section className="panel deadline-panel">
                  <div className="section-head"><div><span className="kicker">DEADLINES</span><h3>Locked timeout schedule</h3></div></div>
                  <div className={`deadline-card ${submissionDeadlineState.className}`}><span>Submission deadline</span><strong>{formatDate(unixToIso(job.summary.submission_deadline_unix))}</strong><em>{submissionDeadlineState.copy}</em></div>
                  <div className={`deadline-card ${adjudicationDeadlineState.className}`}><span>Adjudication deadline</span><strong>{formatDate(unixToIso(job.summary.adjudication_deadline_unix))}</strong><em>{adjudicationDeadlineState.copy}</em></div>
                </section>
              </div>

              <div className="dashboard-grid">
                <section className="panel action-panel">
                  <div className="section-head"><div><span className="kicker">NEXT ACTION</span><h3>Move the workflow</h3></div></div>
                  {status === 'OPEN' && <><button className="primary wide" disabled={!!busy || !isClient} onClick={() => runWrite('Funding escrow', 'fund', [], BigInt(job.financials.reward_wei), true)}>Fund {gen(job.financials.reward_wei)}</button>{!isClient && <p className="hint">Only the Client may fund.</p>}</>}
                  {canSubmit && attemptsRemain && <><label><span className="label-row"><span>Public evidence URL</span><small>{evidenceUrl.length}/{MAX_URL_LENGTH}</small></span><input maxLength={MAX_URL_LENGTH} placeholder="https://..." value={evidenceUrl} onChange={(e) => setEvidenceUrl(e.target.value)} disabled={!isWorker} /></label><button className="primary wide" disabled={!!busy || !isWorker || !evidenceUrl.trim()} onClick={() => runWrite('Submitting deliverable', 'submit_deliverable', [evidenceUrl.trim()])}>{status === 'REJECTED' ? 'Resubmit deliverable' : 'Submit deliverable'}</button>{!isWorker && <p className="hint">Only the Worker may submit.</p>}</>}
                  {status === 'SUBMITTED' && <button className="primary wide" disabled={!!busy} onClick={() => runWrite('Committing reviewed snapshot', 'commit_reviewed_snapshot')}>Build consensus snapshot</button>}
                  {status === 'SNAPSHOT_COMMITTED' && <button className="primary wide" disabled={!!busy} onClick={() => runWrite('AI adjudication', 'adjudicate')}>Adjudicate deliverable</button>}
                  {status === 'ACCEPTED_RESERVED' && <button className="primary wide" disabled={!!busy} onClick={() => runWrite('Releasing worker payout', 'release_reserved_payout', [], 0n, true)}>Release {gen(job.financials.pending_payout_wei)} to Worker</button>}
                  {status === 'REJECTED' && <button className="secondary wide" disabled={!!busy || !isClient} onClick={() => runWrite('Refunding Client', 'refund', [], 0n, true)}>Refund Client</button>}
                  {TERMINAL.has(status) && <div className="terminal-box"><strong>Escrow settled</strong><p>{job.summary.resolution_reason || STATUS_COPY[status]}</p></div>}
                  <button className="ghost wide" onClick={() => refresh(address)} disabled={!!busy}>↻ Refresh accepted state</button>
                </section>

                <section className="panel exit-panel">
                  <div className="section-head"><div><span className="kicker">STALL PROTECTION</span><h3>Safe exit paths</h3></div></div>
                  <div className="exit-option"><div><strong>Deadline cancellation</strong><p>Available only after the applicable locked deadline. Pooled GEN returns to the Client.</p></div><button className="danger" disabled={!!busy || !timeoutAvailable || (!isClient && !isWorker)} onClick={() => runWrite('Cancelling after deadline', 'cancel_after_deadline', [], 0n, true)}>Cancel after deadline</button></div>
                  <div className="exit-option"><div><strong>Mutual close</strong><p>Client and Worker each approve once. The second approval closes the escrow and refunds the Client.</p></div><div className="approval-row"><span className={job.summary.client_close_approved ? 'approved' : ''}>Client {job.summary.client_close_approved ? '✓' : '○'}</span><span className={job.summary.worker_close_approved ? 'approved' : ''}>Worker {job.summary.worker_close_approved ? '✓' : '○'}</span></div><button className="secondary" disabled={!!busy || !mutualCloseAvailable || (!isClient && !isWorker) || currentWalletApproved} onClick={() => runWrite('Approving mutual close', 'approve_mutual_close')}>{currentWalletApproved ? 'Your approval recorded' : 'Approve mutual close'}</button></div>
                </section>
              </div>

              {(job.reviewedSnapshot || job.verdictReason || job.failedRequirements) && (
                <div className="dashboard-grid">
                  <section className="panel"><div className="section-head"><div><span className="kicker">CONSENSUS</span><h3>Reviewed snapshot</h3></div></div><pre>{job.reviewedSnapshot || 'No snapshot committed yet.'}</pre></section>
                  <section className="panel"><div className="section-head"><div><span className="kicker">ADJUDICATION</span><h3>Decision record</h3></div></div><p className="verdict-copy">{job.verdictReason || 'No verdict yet.'}</p>{job.failedRequirements && <div className="failed"><strong>Failed / unverifiable</strong><span>{job.failedRequirements}</span></div>}</section>
                </div>
              )}
            </>
          ) : (
            <div className="empty-dashboard panel"><span className="empty-icon">⌁</span><h3>No escrow loaded</h3><p>Paste a V2 contract address above, choose a recent escrow, or create a new deadline-bound agreement.</p><button className="primary" onClick={() => navigate('create')}>Create escrow</button></div>
          )}
        </section>
      )}

      {(notice || error) && <div className={`toast ${error ? 'error' : ''}`}><div><strong>{error ? 'Action needs attention' : 'Update'}</strong><p>{error || notice}</p>{txHash && <a href={`${EXPLORER_BASE}/transactions/${txHash}`} target="_blank" rel="noreferrer">Open transaction {short(txHash)} ↗</a>}</div><button onClick={() => { setNotice(''); setError('') }}>×</button></div>}
    </main>
  )
}
