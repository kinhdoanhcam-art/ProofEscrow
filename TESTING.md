# ProofEscrow V2 — Testing

## Status

V2 modifies the Intelligent Contract, so historical V1 addresses are not valid runtime evidence. Fresh V2 StudioNet runtime verification has now been completed on the addresses documented below.

Current source SHA-256:

```text
73b87f672cee35e7a9d08328ddad7f89767bfbbb04fc9aa1be479e472c85dfa8
```

## Local/static gates

Run:

```bash
python -m py_compile contracts/ProofEscrow.py
npm run test:v2
npm run test:wallet
npm run build
```

Observed in the package-preparation environment:

```text
PASS  python -m py_compile contracts/ProofEscrow.py
PASS  npm run test:v2 — 20 checks, 0 failed
PASS  TypeScript syntax transpilation for App.tsx, genlayer.ts, config.ts
```

A production build should be re-run in the final dependency-installed checkout before Vercel deployment. Runtime contract verification below is independent of that frontend build gate.

## Steward request coverage

The requested behavior is covered by these V2 paths:

| Steward concern | V2 contract behavior |
| --- | --- |
| Explicit submission deadline | `submission_deadline_unix` locked in constructor; funding/first submission blocked after cutoff |
| Explicit adjudication deadline | `adjudication_deadline_unix` locked in constructor; snapshot/adjudication/resubmission blocked after cutoff |
| Funded GEN stuck before submission | `cancel_after_deadline()` from `FUNDED` after submission deadline |
| Funded GEN stuck during review | `cancel_after_deadline()` from `SUBMITTED` / `SNAPSHOT_COMMITTED` after adjudication deadline |
| Cooperative cancellation | `approve_mutual_close()` with Client + Worker on-chain approval |
| Worker disappears after accepted verdict | `release_reserved_payout()` permissionlessly sends only to immutable Worker |
| UI clarity | dedicated landing/create/dashboard routes, dark cards, deadline cards, truncated addresses, responsive layout |

## Fresh StudioNet runtime matrix

Use at least two wallets:

```text
Wallet 1 = Client / deployer
Wallet 2 = Worker
```

A third observer wallet is useful for the permissionless payout-release test.

### A. Deployment/config

Deploy `contracts/ProofEscrow.py` with:

```text
title
specification
worker
reward_wei
max_attempts
submission_deadline_unix
adjudication_deadline_unix
```

Required constructor relationship:

```text
now < submission_deadline_unix < adjudication_deadline_unix
```

Then call:

```text
get_config()
get_deadlines()
get_job_summary()
```

Expected config flags:

```text
version = 2.0
explicit_submission_deadline = true
explicit_adjudication_deadline = true
deadline_cancellation = true
mutual_close = true
permissionless_reserved_release = true
```

### B. Pre-deadline timeout guard

After funding, call `cancel_after_deadline()` before the submission deadline.

Expected:

```text
ERROR: Submission deadline has not passed
```

This proves the timeout path cannot be used early.

### C. Mutual-close path

On a funded test escrow before either deadline:

1. Client calls `approve_mutual_close()`.
2. `get_close_state()` shows Client approved, Worker not approved, status still `FUNDED`.
3. Worker calls `approve_mutual_close()`.
4. Expected terminal state:

```text
status = MUTUALLY_CLOSED
pool = 0
reserved = 0
pending_payout = 0
```

The pooled GEN must return to the Client.

### D. Submission-timeout path

Use a separate short-deadline test escrow:

1. Client funds before submission deadline.
2. Worker does not submit.
3. After the submission deadline, Client or Worker calls `cancel_after_deadline()`.
4. Expected:

```text
status = CANCELLED_TIMEOUT
pool = 0
resolution_reason = Submission deadline elapsed before a deliverable was submitted
```

### E. Normal accepted settlement

Use a normal-deadline escrow:

```text
OPEN -> fund -> FUNDED
FUNDED -> submit_deliverable -> SUBMITTED
SUBMITTED -> commit_reviewed_snapshot -> SNAPSHOT_COMMITTED
SNAPSHOT_COMMITTED -> adjudicate -> ACCEPTED_RESERVED
```

After `ACCEPTED_RESERVED`, use an Observer or Client wallet to call:

```text
release_reserved_payout()
```

Expected:

```text
status = PAID
pool = 0
reserved = 0
pending_payout = 0
```

This proves accepted funds do not require the Worker to return merely to trigger settlement.

### F. Rejected/refund path

If adjudication returns `REJECTED`, verify:

- Client may call `refund()` immediately; or
- Worker may resubmit while attempts remain and before adjudication deadline.

Expected refund terminal state:

```text
status = REFUNDED
pool = 0
```

### G. Adjudication-timeout path

Use a separate escrow whose Worker submits before the submission deadline but whose workflow is intentionally left in `SUBMITTED` or `SNAPSHOT_COMMITTED` until the adjudication deadline passes.

Then Client or Worker calls:

```text
cancel_after_deadline()
```

Expected:

```text
status = CANCELLED_TIMEOUT
pool = 0
resolution_reason = Adjudication deadline elapsed before final settlement
```

## Observed StudioNet runtime results

Wallet roles used for the verified runs:

```text
Client / deployer: 0x3065E31B1D993d7C0D59E6786844cBa56780B2d3
Worker:            0xdaE8968571C6E84f44F86d06F1071bbc8F807500
```

| Address | Verified path | Final state | Result |
| --- | --- | --- | --- |
| `0xC09951A1a09BE682E72844CAf9AB9903E5921929` | Worker submitted, workflow intentionally stalled past adjudication deadline, then `cancel_after_deadline()` | `CANCELLED_TIMEOUT` | PASS |
| `0xBf3F249487C63155f094D0e5348115dce06E8D73` | Client approval then Worker approval via `approve_mutual_close()` | `MUTUALLY_CLOSED` | PASS |
| `0x67Be788c86Ef9f224C940434b413709B287Ec04C` | Evidence did not fully satisfy immutable specification | `REJECTED` | PASS negative case |
| `0x3ADEDD82008Fd54a0eB9DAA9477743B2b8851008` | Fund 1 GEN -> submit -> snapshot -> adjudicate -> `ACCEPTED_RESERVED`; Client triggers `release_reserved_payout()` | `PAID` | PASS |

Observed financial state immediately before the final payout-release call on `0x3ADE...1008`:

```text
pool_wei = 1000000000000000000
reserved_wei = 1000000000000000000
pending_payout_wei = 1000000000000000000
```

Observed after the **Client**, not the Worker, called `release_reserved_payout()`:

```text
status = PAID
resolution_reason = Accepted payout released to Worker
pool_wei = 0
reserved_wei = 0
pending_payout_wei = 0
```

This proves the settlement trigger is permissionless while the immutable payout recipient remains the Worker.

### Timeout guard detail

The timeout instance recorded:

```text
status = CANCELLED_TIMEOUT
resolution_reason = Adjudication deadline elapsed before final settlement
```

### Mutual-close detail

The mutual-close instance recorded:

```text
status = MUTUALLY_CLOSED
resolution_reason = Client and Worker mutually approved escrow closure
```

The per-party approval flags reset after terminal settlement by design; the terminal state and resolution reason are the durable closure evidence.

## Production UI checklist

After the V2 source is deployed and its new address is configured in the frontend:

- `#/` renders the landing page.
- `#/create` renders a dedicated creation page.
- both deadline inputs are visible and validated.
- `#/dashboard` loads a V2 address without showing V1 state.
- Client and Worker addresses are truncated and copyable.
- deadline cards show absolute time plus remaining/expired state.
- timeout cancellation is disabled before the relevant cutoff.
- mutual-close approvals visibly reflect on-chain Client/Worker flags.
- terminal resolution reason is visible after timeout or mutual close.
- desktop and 390px mobile layouts do not horizontally overflow.
- no browser console errors during load/read/write flows.

## Historical addresses

Do not use these as V2 evidence:

```text
0xdD4ecd08d0F23E504b2Bdd6bD1150a5d3C630436  # old reference deployment
0x9d829aF09870Fc4597983E4b0e6AFBBB0ce9B396  # old browser-test instance
```

## Evidence discipline

Only mark a runtime row PASS after observing the accepted on-chain state or intended rollback. Do not infer a timeout PASS from source code alone.
