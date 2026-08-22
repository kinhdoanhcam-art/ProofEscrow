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
import {
  DEFAULT_CONTRACT_ADDRESS,
  EXPLORER_BASE,
  LAST_CONTRACT_KEY,
} from './lib/config'
import { normalizeError } from './lib/errors'

type Mode = 'dashboard' | 'create'

const short = (value: string) =>
  value ? `${value.slice(0, 6)}...${value.slice(-4)}` : '—'

const gen = (wei: string) => {
  try {
    return `${Number(formatEther(BigInt(wei))).toLocaleString()} GEN`
  } catch {
    return '0 GEN'
  }
}

const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms))

const EXPECTED_STATUSES: Record<string, string[]> = {
  fund: ['FUNDED'],
  submit_deliverable: ['SUBMITTED'],
  commit_reviewed_snapshot: ['SNAPSHOT_COMMITTED'],
  adjudicate: ['ACCEPTED_RESERVED', 'REJECTED'],
  withdraw: ['PAID'],
  refund: ['REFUNDED'],
}

const MAX_TITLE_LENGTH = 160
const MAX_SPEC_LENGTH = 2000
const MAX_URL_LENGTH = 1000
const RECENT_JOBS_KEY = 'proofEscrow:recentJobs'

/**
 * The escrow lifecycle in plain language. Drives the stepper so someone who has
 * never seen this app can tell where a job is and whose turn it is.
 */
const LIFECYCLE: Array<{
  key: string
  label: string
  who: string
  detail: string
}> = [
  { key: 'OPEN', label: 'Created', who: 'Client', detail: 'Specification and reward are locked in a new contract.' },
  { key: 'FUNDED', label: 'Funded', who: 'Client', detail: 'The client deposits the exact reward into escrow.' },
  { key: 'SUBMITTED', label: 'Work submitted', who: 'Worker', detail: 'The worker submits a public URL as evidence.' },
  { key: 'SNAPSHOT_COMMITTED', label: 'Evidence snapshot', who: 'Anyone', detail: 'Validators read the evidence and agree on a factual record of it. No verdict yet.' },
  { key: 'ACCEPTED_RESERVED', label: 'Judged', who: 'Anyone', detail: 'Validators judge that snapshot against the locked spec: accepted or rejected.' },
  { key: 'PAID', label: 'Settled', who: 'Worker / Client', detail: 'Accepted work is withdrawn by the worker; rejected work is refunded to the client.' },
]

/** Which lifecycle step a raw contract status belongs to. */
const STEP_OF: Record<string, number> = {
  OPEN: 0,
  FUNDED: 1,
  SUBMITTED: 2,
  SNAPSHOT_COMMITTED: 3,
  ACCEPTED_RESERVED: 4,
  REJECTED: 4,
  PAID: 5,
  REFUNDED: 5,
}

/** One sentence explaining the current state and whose turn it is. */
const STATUS_EXPLAINER: Record<string, string> = {
  OPEN: 'Waiting for the client to deposit the reward into escrow.',
  FUNDED: 'Escrow is funded. Waiting for the worker to submit a public evidence URL.',
  SUBMITTED: 'Evidence submitted. Anyone can now ask the validators to record what the evidence actually shows.',
  SNAPSHOT_COMMITTED: 'The factual snapshot is agreed on-chain. Anyone can now ask the validators for a verdict against the locked specification.',
  ACCEPTED_RESERVED: 'Accepted. The reward is reserved and the worker can withdraw it.',
  REJECTED: 'Rejected. The worker may resubmit while attempts remain, or the client may close and take a refund.',
  PAID: 'Finished — the worker has withdrawn the reward.',
  REFUNDED: 'Finished — the client has been refunded.',
}

type RecentJob = {
  address: Address
  title: string
  status: string
}

const formatElapsed = (seconds: number) => {
  const mins = Math.floor(seconds / 60).toString().padStart(2, '0')
  const secs = (seconds % 60).toString().padStart(2, '0')
  return `${mins}:${secs}`
}

export default function App() {
  const [account, setAccount] = useState<Address | null>(null)
  const [mode, setMode] = useState<Mode>('dashboard')
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

  const [title, setTitle] = useState('Landing Page Delivery Escrow')
  const [specification, setSpecification] = useState(
    'The submitted public landing page must: 1. display a visible project title; 2. include a visible Pricing section; 3. display a visible Connect Wallet button; 4. include a visible README or Documentation link.',
  )
  const [worker, setWorker] = useState('')
  const [rewardGen, setRewardGen] = useState('5')
  const [maxAttempts, setMaxAttempts] = useState('2')

  const operationLock = useRef(false)

  function saveRecentJob(next: RecentJob) {
    setRecentJobs((current) => {
      const deduped = current.filter(
        (item) => item.address.toLowerCase() !== next.address.toLowerCase(),
      )
      const updated = [next, ...deduped].slice(0, 8)
      localStorage.setItem(RECENT_JOBS_KEY, JSON.stringify(updated))
      return updated
    })
  }

  const address = useMemo(
    () => (isAddress(contractAddress) ? (contractAddress as Address) : null),
    [contractAddress],
  )

  const isClient =
    !!account &&
    !!job &&
    account.toLowerCase() === job.summary.client.toLowerCase()

  const isWorker =
    !!account &&
    !!job &&
    account.toLowerCase() === job.summary.worker.toLowerCase()

  useEffect(() => {
    void (async () => {
      const restored = await getAuthorizedAccount()
      if (restored) setAccount(restored)

      const saved =
        DEFAULT_CONTRACT_ADDRESS ||
        localStorage.getItem(LAST_CONTRACT_KEY) ||
        ''

      if (saved && isAddress(saved)) {
        setContractAddress(saved)
        setLoadAddress(saved)
      }

      try {
        const storedJobs = JSON.parse(
          localStorage.getItem(RECENT_JOBS_KEY) || '[]',
        ) as RecentJob[]
        setRecentJobs(Array.isArray(storedJobs) ? storedJobs : [])
      } catch {
        setRecentJobs([])
      }
    })()
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

    return () => {
      window.ethereum?.removeListener?.('accountsChanged', handleAccountsChanged)
    }
  }, [])

  useEffect(() => {
    if (!notice) return
    if (notice.toLowerCase().includes('submitted')) return

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
    return () => {
      cancelled = true
    }
  }, [busy, deployStage])

  useEffect(() => {
    if (!address) {
      setJob(null)
      return
    }

    void refresh(address)
  }, [address])

  async function refresh(
    target = address,
    options: { quiet?: boolean; clearOnFailure?: boolean } = {},
  ): Promise<JobState | null> {
    if (!target) return null

    try {
      const next = await readJob(target)
      setJob(next)
      saveRecentJob({
        address: target,
        title: next.summary.title || 'Loaded escrow',
        status: next.summary.status,
      })
      if (!options.quiet) setError('')
      return next
    } catch (err) {
      console.error('[ProofEscrow] raw refresh error:', err)
      if (options.clearOnFailure) setJob(null)
      if (!options.quiet) {
        setError(normalizeError(err))
      }
      return null
    }
  }

  async function pollForExpectedState(
    target: Address,
    expected: string[],
    attempts = 9,
  ): Promise<JobState | null> {
    for (let i = 0; i < attempts; i += 1) {
      const next = await refresh(target, { quiet: true })

      if (next && expected.includes(next.summary.status)) {
        setError('')
        return next
      }

      if (i < attempts - 1) {
        await sleep(Math.min(1200 * (i + 1), 7000))
      }
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
          setMode('create')
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

      // The account is authoritative here. An optional step failing afterwards
      // must never leave the UI disconnected.
      setAccount(next)

      if (warning) {
        setNotice(`Connected ${short(next)} — ${warning}`)
      } else {
        setNotice(`Connected ${short(next)}`)
      }
    })
  }

  async function handleLoad() {
    if (!isAddress(loadAddress)) {
      setError('Enter a valid GenLayer contract address.')
      return
    }

    const target = loadAddress as Address

    // Never leave stale data from the previous escrow on screen.
    setJob(null)
    setError('')
    setContractAddress(target)
    localStorage.setItem(LAST_CONTRACT_KEY, target)
    setMode('dashboard')

    const loaded = await pollForExpectedState(
      target,
      [
        'OPEN',
        'FUNDED',
        'SUBMITTED',
        'SNAPSHOT_COMMITTED',
        'ACCEPTED_RESERVED',
        'REJECTED',
        'PAID',
        'REFUNDED',
      ],
      6,
    )

    if (!loaded) {
      setNotice(
        'Escrow address loaded, but StudioNet RPC is temporarily unavailable. Use Refresh State; do not redeploy.',
      )
      saveRecentJob({ address: target, title: 'Loaded escrow', status: 'SYNCING' })
    } else {
      saveRecentJob({
        address: target,
        title: loaded.summary.title || 'Loaded escrow',
        status: loaded.summary.status,
      })
    }
  }

  async function handleCreate() {
    if (!account) {
      setError('Connect the client wallet first.')
      return
    }

    if (!isAddress(worker)) {
      setError('Worker address is invalid.')
      return
    }

    const cleanTitle = title.trim()
    const cleanSpecification = specification.trim()

    if (!cleanTitle || !cleanSpecification) {
      setError('Title and specification are required.')
      return
    }

    if (cleanTitle.length > MAX_TITLE_LENGTH) {
      setError(`Job title must be ${MAX_TITLE_LENGTH} characters or fewer.`)
      return
    }

    if (cleanSpecification.length > MAX_SPEC_LENGTH) {
      setError(`Specification must be ${MAX_SPEC_LENGTH} characters or fewer.`)
      return
    }

    const attempts = Number(maxAttempts)
    if (!Number.isInteger(attempts) || attempts < 1 || attempts > 5) {
      setError('Max attempts must be between 1 and 5.')
      return
    }

    let rewardWei: bigint
    try {
      rewardWei = parseEther(rewardGen)
      if (rewardWei <= 0n) throw new Error()
    } catch {
      setError('Reward must be a positive GEN amount.')
      return
    }

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
        onHash: (hash) => setTxHash(hash),
        onStage: (stage) => setDeployStage(stage),
      })

      // Clear any previous escrow immediately so a failed refresh can
      // never make an old job look like the newly deployed contract.
      setJob(null)
      setContractAddress(deployed.address)
      setLoadAddress(deployed.address)
      localStorage.setItem(LAST_CONTRACT_KEY, deployed.address)
      saveRecentJob({
        address: deployed.address,
        title: cleanTitle,
        status: 'OPEN',
      })
      setMode('dashboard')

      const loaded = await pollForExpectedState(
        deployed.address,
        ['OPEN'],
        8,
      )

      setNotice(
        loaded
          ? `Escrow deployed at ${deployed.address}`
          : `Escrow deployed at ${deployed.address}. State refresh is delayed by StudioNet RPC; do not deploy again.`,
      )
    })
  }

  async function handleRecoverAddress() {
    if (!isAddress(recoveryAddress)) {
      setError('Paste a valid deployed contract address from Explorer.')
      return
    }

    const target = recoveryAddress as Address
    setContractAddress(target)
    setLoadAddress(target)
    localStorage.setItem(LAST_CONTRACT_KEY, target)
    saveRecentJob({ address: target, title: title.trim() || 'Recovered escrow', status: 'SYNCING' })
    setDeployStage('confirmed')
    setError('')
    setMode('dashboard')

    const loaded = await pollForExpectedState(target, ['OPEN'], 8)
    if (loaded) {
      saveRecentJob({
        address: target,
        title: loaded.summary.title || title.trim() || 'Recovered escrow',
        status: loaded.summary.status,
      })
      setNotice(`Recovered escrow ${target}`)
    } else {
      setNotice(
        `Escrow ${target} saved. StudioNet state is still syncing; use Refresh State instead of redeploying.`,
      )
    }
  }

  async function runWrite(
    label: string,
    functionName: string,
    args: unknown[] = [],
    value = 0n,
    finalized = false,
  ) {
    if (!account || !address) {
      setError('Connect wallet and load an escrow first.')
      return
    }

    const expected = EXPECTED_STATUSES[functionName] || []

    await guarded(label, async () => {
      try {
        await writeEscrow({
          account,
          address,
          functionName,
          args,
          value,
          waitForFinalized: finalized,
          onHash: (hash) => setTxHash(hash),
        })
      } catch (err) {
        if (err instanceof SubmittedButUnconfirmedError) {
          setTxHash(err.hash)
          setError('')
          setNotice(
            'Transaction submitted. RPC confirmation is temporarily unavailable; checking accepted contract state. Do not submit again.',
          )

          if (expected.length > 0) {
            const recovered = await pollForExpectedState(
              address,
              expected,
              10,
            )

            if (recovered) {
              setNotice(
                `${functionName} confirmed on-chain after RPC recovery.`,
              )
            } else {
              setNotice(
                `Transaction ${short(err.hash)} was submitted. State is still syncing; use Refresh State or Explorer before taking another action.`,
              )
            }
          }

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
      }

      setNotice(
        `${functionName} was accepted by the network. Contract state refresh is delayed; do not submit again.`,
      )
    })
  }

  const status = job?.summary.status || ''
  const role = !account || !job ? '—' : isClient ? 'CLIENT' : isWorker ? 'WORKER' : 'OBSERVER'

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">GENLAYER · STUDIO NET</div>
          <h1>ProofEscrow</h1>
          <p className="tagline">
            AI-verified work. Deterministic GEN escrow settlement.
          </p>
        </div>

        <button className="wallet" onClick={handleConnect} disabled={!!busy}>
          {account ? short(account) : 'Connect Wallet'}
        </button>
      </header>

      <section className="tabs">
        <button
          className={mode === 'dashboard' ? 'active' : ''}
          onClick={() => setMode('dashboard')}
        >
          Escrow
        </button>
        <button
          className={mode === 'create' ? 'active' : ''}
          onClick={() => setMode('create')}
        >
          Create Job
        </button>
      </section>

      {mode === 'create' ? (
        <section className="card create-card">
          <div className="section-title">
            <div>
              <span>CLIENT</span>
              <h2>Create funded work agreement</h2>
            </div>
          </div>

          <label>
            <span className="label-row">
              <span>Job title</span>
              <span className="counter">{title.length} / {MAX_TITLE_LENGTH}</span>
            </span>
            <input
              maxLength={MAX_TITLE_LENGTH}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>

          <label>
            <span className="label-row">
              <span>Locked acceptance specification</span>
              <span className="counter">{specification.length} / {MAX_SPEC_LENGTH}</span>
            </span>
            <textarea
              rows={7}
              maxLength={MAX_SPEC_LENGTH}
              value={specification}
              onChange={(e) => setSpecification(e.target.value)}
            />
          </label>

          <div className="grid two">
            <label>
              Worker wallet
              <input
                placeholder="0x..."
                value={worker}
                onChange={(e) => setWorker(e.target.value)}
              />
            </label>

            <label>
              Reward (GEN)
              <input
                type="number"
                min="0"
                step="0.1"
                value={rewardGen}
                onChange={(e) => setRewardGen(e.target.value)}
              />
            </label>
          </div>

          <label>
            Max submission attempts
            <input
              type="number"
              min="1"
              max="5"
              value={maxAttempts}
              onChange={(e) => setMaxAttempts(e.target.value)}
            />
          </label>

          <button className="primary" onClick={handleCreate} disabled={!!busy}>
            {busy === 'Deploying escrow' ? 'Deploying…' : 'Deploy Escrow'}
          </button>

          {busy === 'Deploying escrow' && (
            <div className="deploy-progress">
              {deployStage === 'submitting' && <strong>Submitting to wallet…</strong>}
              {deployStage === 'waiting' && (
                <strong>Waiting for consensus ({formatElapsed(deployElapsed)})</strong>
              )}
              {deployStage === 'confirmed' && <strong>Contract address confirmed.</strong>}
            </div>
          )}

          {deployStage === 'recovery' && txHash && (
            <div className="recovery-box">
              <strong>Deployment was submitted.</strong>
              <span>
                Receipt monitoring did not recover the contract address. Do not deploy again.
                Open the transaction in Explorer, copy the deployed contract address, and paste it below.
              </span>
              <a
                href={`${EXPLORER_BASE}/transactions/${txHash}`}
                target="_blank"
                rel="noreferrer"
              >
                Open transaction {short(txHash)} ↗
              </a>
              <div className="recovery-row">
                <input
                  placeholder="Paste deployed contract address: 0x..."
                  value={recoveryAddress}
                  onChange={(e) => setRecoveryAddress(e.target.value)}
                />
                <button className="secondary" onClick={handleRecoverAddress}>
                  Recover Job
                </button>
              </div>
            </div>
          )}
        </section>
      ) : (
        <>
          <section className="loadbar card">
            <input
              placeholder="Load escrow contract: 0x..."
              value={loadAddress}
              onChange={(e) => setLoadAddress(e.target.value)}
            />
            <button onClick={handleLoad}>Load</button>
            {address && (
              <a
                href={`${EXPLORER_BASE}/address/${address}`}
                target="_blank"
                rel="noreferrer"
              >
                Explorer ↗
              </a>
            )}
          </section>

          {recentJobs.length > 0 && (
            <section className="card recent-jobs">
              <div className="section-title">
                <div>
                  <span>RECENT</span>
                  <h3>Your recent escrows</h3>
                </div>
              </div>
              <div className="recent-list">
                {recentJobs.map((item) => (
                  <button
                    key={item.address}
                    className="recent-item"
                    onClick={() => {
                      setLoadAddress(item.address)
                      setContractAddress(item.address)
                      localStorage.setItem(LAST_CONTRACT_KEY, item.address)
                    }}
                  >
                    <span>
                      <strong>{item.title}</strong>
                      <small>{short(item.address)}</small>
                    </span>
                    <span className="recent-status">{item.status}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {job ? (
            <>
              <section className="hero card">
                <div>
                  <div className="status-row">
                    <span className={`status ${status.toLowerCase()}`}>
                      {status}
                    </span>
                    <span className="attempts">
                      Attempt {job.summary.attempt_count}/{job.summary.max_attempts}
                    </span>
                    <span className={`role-badge ${role.toLowerCase()}`}>{role}</span>
                  </div>
                  <h2>{job.summary.title}</h2>
                  <p className="spec">{job.specification}</p>
                  {STATUS_EXPLAINER[status] && (
                    <p className="status-explainer">{STATUS_EXPLAINER[status]}</p>
                  )}
                </div>

                <div className="money">
                  <span>Reward</span>
                  <strong>{gen(job.financials.reward_wei)}</strong>
                </div>
              </section>

              <ol className="stepper card" aria-label="Escrow lifecycle">
                {LIFECYCLE.map((step, index) => {
                  const current = STEP_OF[status] ?? 0
                  const state =
                    index < current ? 'done' : index === current ? 'current' : 'todo'
                  const label =
                    step.key === 'ACCEPTED_RESERVED' && status === 'REJECTED'
                      ? 'Judged — rejected'
                      : step.key === 'PAID' && status === 'REFUNDED'
                        ? 'Settled — refunded'
                        : step.label
                  return (
                    <li key={step.key} className={`step ${state}`}>
                      <span className="step-index">{index + 1}</span>
                      <span className="step-body">
                        <strong>{label}</strong>
                        <em>{step.who}</em>
                        <span>{step.detail}</span>
                      </span>
                    </li>
                  )
                })}
              </ol>

              <section className="grid three">
                <article className="metric card">
                  <span>Pool</span>
                  <strong>{gen(job.financials.pool_wei)}</strong>
                </article>
                <article className="metric card">
                  <span>Reserved</span>
                  <strong>{gen(job.financials.reserved_wei)}</strong>
                </article>
                <article className="metric card">
                  <span>Pending payout</span>
                  <strong>{gen(job.financials.pending_payout_wei)}</strong>
                </article>
              </section>

              <section className="grid two">
                <article className="card">
                  <div className="section-title">
                    <div>
                      <span>PARTIES</span>
                      <h3>Agreement</h3>
                    </div>
                  </div>
                  <dl>
                    <div>
                      <dt>Client</dt>
                      <dd>{job.summary.client}</dd>
                    </div>
                    <div>
                      <dt>Worker</dt>
                      <dd>{job.summary.worker}</dd>
                    </div>
                    <div>
                      <dt>Spec hash</dt>
                      <dd>{job.summary.spec_hash}</dd>
                    </div>
                  </dl>
                </article>

                <article className="card actions">
                  <div className="section-title">
                    <div>
                      <span>ACTIONS</span>
                      <h3>Next step</h3>
                    </div>
                  </div>

                  {status === 'OPEN' && (
                    <>
                      <button
                        className="primary"
                        onClick={() =>
                          runWrite(
                            'Funding escrow',
                            'fund',
                            [],
                            BigInt(job.financials.reward_wei),
                            true,
                          )
                        }
                        disabled={!!busy || !isClient}
                        title={!isClient ? 'Only the client may fund' : undefined}
                      >
                        Fund {gen(job.financials.reward_wei)}
                      </button>
                      {!isClient && <p className="action-hint">Only the client may fund.</p>}
                    </>
                  )}

                  {(status === 'FUNDED' || status === 'REJECTED') &&
                    Number(job.summary.attempt_count) <
                      Number(job.summary.max_attempts) && (
                      <>
                        <label className="evidence-field">
                          <span className="label-row">
                            <span>Public evidence URL</span>
                            <span className="counter">{evidenceUrl.length} / {MAX_URL_LENGTH}</span>
                          </span>
                          <input
                            placeholder="https://..."
                            maxLength={MAX_URL_LENGTH}
                            value={evidenceUrl}
                            onChange={(e) => setEvidenceUrl(e.target.value)}
                            disabled={!isWorker}
                          />
                        </label>
                        <button
                          className="primary"
                          disabled={!!busy || !isWorker || !evidenceUrl.trim()}
                          title={!isWorker ? 'Only the worker may submit evidence' : undefined}
                          onClick={() =>
                            runWrite(
                              'Submitting deliverable',
                              'submit_deliverable',
                              [evidenceUrl.trim()],
                            )
                          }
                        >
                          {status === 'REJECTED'
                            ? 'Resubmit Deliverable'
                            : 'Submit Deliverable'}
                        </button>
                        {!isWorker && (
                          <p className="action-hint">Only the worker may submit evidence.</p>
                        )}
                      </>
                    )}

                  {status === 'SUBMITTED' && (
                    <button
                      className="primary"
                      disabled={!!busy}
                      onClick={() =>
                        runWrite(
                          'Committing reviewed snapshot',
                          'commit_reviewed_snapshot',
                        )
                      }
                    >
                      Build Consensus Snapshot
                    </button>
                  )}

                  {status === 'SNAPSHOT_COMMITTED' && (
                    <button
                      className="primary"
                      disabled={!!busy}
                      onClick={() =>
                        runWrite('AI adjudication', 'adjudicate')
                      }
                    >
                      Adjudicate Deliverable
                    </button>
                  )}

                  {status === 'ACCEPTED_RESERVED' && (
                    <>
                      <button
                        className="primary"
                        disabled={!!busy || !isWorker}
                        title={!isWorker ? 'Only the worker may withdraw' : undefined}
                        onClick={() =>
                          runWrite(
                            'Withdrawing GEN',
                            'withdraw',
                            [],
                            0n,
                            true,
                          )
                        }
                      >
                        Withdraw {gen(job.financials.pending_payout_wei)}
                      </button>
                      {!isWorker && <p className="action-hint">Only the worker may withdraw.</p>}
                    </>
                  )}

                  {status === 'REJECTED' && (
                    <>
                      <button
                        className="danger"
                        disabled={!!busy || !isClient}
                        title={!isClient ? 'Only the client may refund' : undefined}
                        onClick={() =>
                          runWrite(
                            'Refunding client',
                            'refund',
                            [],
                            0n,
                            true,
                          )
                        }
                      >
                        Close & Refund
                      </button>
                      {!isClient && <p className="action-hint">Only the client may refund.</p>}
                    </>
                  )}

                  {!account && <p>Connect the relevant wallet to act.</p>}
                  {account && !isClient && !isWorker && (
                    <p>This wallet is an observer for this escrow.</p>
                  )}

                  <button
                    className="secondary"
                    onClick={() => address && refresh(address)}
                    disabled={!!busy}
                  >
                    Refresh State
                  </button>
                </article>
              </section>

              {(job.reviewedSnapshot ||
                job.verdictReason ||
                job.failedRequirements) && (
                <section className="grid two">
                  <article className="card">
                    <div className="section-title">
                      <div>
                        <span>CONSENSUS</span>
                        <h3>Reviewed Snapshot</h3>
                      </div>
                    </div>
                    <pre>
                      {job.reviewedSnapshot || 'No snapshot committed yet.'}
                    </pre>
                  </article>

                  <article className="card">
                    <div className="section-title">
                      <div>
                        <span>VERDICT</span>
                        <h3>Adjudication</h3>
                      </div>
                    </div>
                    <p>{job.verdictReason || 'No verdict yet.'}</p>
                    {job.failedRequirements && (
                      <div className="failed">
                        Failed: {job.failedRequirements}
                      </div>
                    )}
                  </article>
                </section>
              )}
            </>
          ) : (
            <section className="empty card">
              <h2>Load or create an escrow</h2>
              <p>
                Each ProofEscrow contract represents one client-worker
                agreement with a locked specification and native GEN reward.
              </p>
              <p className="explainer-lead">
                A client locks a written specification and deposits the reward. A
                worker submits a public URL as evidence. GenLayer validators then
                do two separate things — first they agree on a factual record of
                what the evidence actually shows, and only then do they judge that
                record against the locked specification. The contract holds and
                releases the money; the validators never touch it.
              </p>
              <ol className="stepper inline-stepper">
                {LIFECYCLE.map((step, index) => (
                  <li key={step.key} className="step todo">
                    <span className="step-index">{index + 1}</span>
                    <span className="step-body">
                      <strong>{step.label}</strong>
                      <em>{step.who}</em>
                      <span>{step.detail}</span>
                    </span>
                  </li>
                ))}
              </ol>
              <p className="explainer-note">
                Reading an escrow needs no wallet. Paste any ProofEscrow address
                above to inspect it. Funding, submitting and settling need a
                wallet on GenLayer Studio — and the client and worker must be two
                different wallets.
              </p>
            </section>
          )}
        </>
      )}

      {(notice || error || txHash || busy) && (
        <aside className={`toast ${error ? 'error' : ''}`}>
          <button
            className="toast-close"
            aria-label="Dismiss message"
            onClick={() => {
              setNotice('')
              setError('')
              if (!busy) setTxHash('')
            }}
          >
            ×
          </button>
          <div className="toast-content">
            {busy && <strong>{busy}…</strong>}
            {notice && <span>{notice}</span>}
            {error && <span>{error}</span>}
            {txHash && (
              <a
                href={`${EXPLORER_BASE}/transactions/${txHash}`}
                target="_blank"
                rel="noreferrer"
              >
                Transaction {short(txHash)} ↗
              </a>
            )}
          </div>
        </aside>
      )}
    </main>
  )
}
