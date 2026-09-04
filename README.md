# ProofEscrow V2

**Deadline-safe, AI-adjudicated work escrow on GenLayer.**

ProofEscrow connects qualitative AI-validator review to deterministic native GEN settlement. Each job is its own contract instance. The Client locks a natural-language acceptance specification, Worker, reward, maximum attempts, **submission deadline**, and **adjudication deadline**. The Worker submits public evidence, validators commit a factual snapshot, and a separate adjudication stage judges that snapshot against the immutable specification.

V2 directly addresses the steward request that funded GEN must not remain locked when the workflow stalls.

## V2 stall-protection model

### 1. Explicit submission deadline

The constructor stores `submission_deadline_unix` on-chain. The Client cannot fund after it has passed. A first Worker submission must arrive before it.

If the escrow is still `FUNDED` when the deadline passes, either the Client or Worker may call:

```text
cancel_after_deadline()
```

The full pooled GEN is returned only to the Client and the terminal status becomes:

```text
CANCELLED_TIMEOUT
```

### 2. Explicit adjudication deadline

The constructor also stores `adjudication_deadline_unix`, which must be later than the submission deadline.

Snapshot creation, adjudication, and rejected-work resubmission cannot continue after this final deadline. If funds are still pooled in `SUBMITTED`, `SNAPSHOT_COMMITTED`, or `REJECTED`, either party may trigger the same timeout cancellation path.

### 3. Mutual close

Before a timeout, Client and Worker can each call:

```text
approve_mutual_close()
```

The approvals are stored on-chain. Only when **both** parties have approved does the escrow close and return the pooled GEN to the Client:

```text
MUTUALLY_CLOSED
```

Progressing the workflow clears stale mutual-close approvals so consent applies to the current workflow state.

### 4. Accepted payout cannot depend on the Worker returning

Once adjudication reaches `ACCEPTED_RESERVED`, the recipient and amount are already fixed. V2 therefore adds:

```text
release_reserved_payout()
```

Anyone may call it, but the payout can only be transferred to the immutable Worker address. This prevents an already-earned payout from remaining stranded if the Worker does not manually call `withdraw()`.

## Lifecycle

```text
OPEN
  ↓ fund() before submission deadline
FUNDED
  ↓ submit_deliverable() before submission deadline
SUBMITTED
  ↓ commit_reviewed_snapshot() before adjudication deadline
SNAPSHOT_COMMITTED
  ↓ adjudicate() before adjudication deadline

        ┌─────────────────────────┐
        ▼                         ▼
ACCEPTED_RESERVED               REJECTED
        │                         ├─ resubmit before final deadline
        │ withdraw()              └─ refund()
        │ or release_reserved_payout()
        ▼
       PAID

FUNDED -- submission deadline --> CANCELLED_TIMEOUT
SUBMITTED / SNAPSHOT_COMMITTED -- adjudication deadline --> CANCELLED_TIMEOUT
FUNDED / SUBMITTED / SNAPSHOT_COMMITTED / REJECTED -- 2-of-2 mutual close --> MUTUALLY_CLOSED
```

## Two-stage AI review

**Stage 1 — reviewed snapshot.** Validators inspect the submitted public evidence and commit a concise factual snapshot containing observable facts and material limitations. This stage does not decide acceptance.

**Stage 2 — adjudication.** Validators judge only the immutable specification against the committed snapshot. Missing or unverifiable material requirements fail closed to `REJECTED`.

## Deterministic accounting

ProofEscrow deterministically enforces:

- immutable Client and Worker addresses;
- immutable acceptance specification + SHA-256 hash;
- exact native GEN reward funding;
- bounded submission attempts;
- explicit timeout cutoffs;
- Client-only refund destination;
- Worker-only accepted payout destination;
- pool / reserved / pending-payout accounting;
- terminal settlement states.

## V2 contract surface

New or materially changed methods:

```text
constructor(
  title,
  specification,
  worker,
  reward_wei,
  max_attempts,
  submission_deadline_unix,
  adjudication_deadline_unix
)

approve_mutual_close()
cancel_after_deadline()
release_reserved_payout()
get_deadlines()
get_close_state()
get_config()
```

`get_job_summary()` also exposes both deadlines, mutual-close approvals, and terminal resolution reason.

## UI / UX redesign

The V2 frontend is split into dedicated hash-routed pages:

```text
#/            Landing / product overview
#/create      Escrow creation
#/dashboard   Escrow dashboard
```

The redesign includes:

- modern dark-mode surfaces and high-contrast status cards;
- dedicated landing, creation, and dashboard experiences;
- explicit date/time inputs for both deadlines;
- workflow-aware deadline state on the dashboard: completed/resolved milestones stay neutral/green instead of turning into false red expiry warnings after settlement;
- stall-protection panel for timeout cancellation and 2-of-2 mutual close;
- compact address truncation with copy controls;
- responsive desktop/tablet/mobile layouts;
- role-aware disabled actions with explanations;
- resilient wallet/RPC handling retained from the previous steward fix;
- locally remembered recent escrow addresses for navigation only; authoritative state is always read from the contract.

## Verified V2 StudioNet runtime

The V2 source in this repository was exercised on fresh StudioNet deployments with the same contract SHA-256 shown below. The runtime matrix covered the steward-requested stall and settlement paths:

```text
0xC09951A1a09BE682E72844CAf9AB9903E5921929
  SUBMITTED -> adjudication deadline elapsed -> CANCELLED_TIMEOUT
  resolution: Adjudication deadline elapsed before final settlement

0xBf3F249487C63155f094D0e5348115dce06E8D73
  FUNDED -> Client approval -> Worker approval -> MUTUALLY_CLOSED
  resolution: Client and Worker mutually approved escrow closure

0x67Be788c86Ef9f224C940434b413709B287Ec04C
  negative adjudication case -> REJECTED when evidence wording did not satisfy the immutable specification

0x3ADEDD82008Fd54a0eB9DAA9477743B2b8851008
  normal settlement -> ACCEPTED_RESERVED -> permissionless release by Client -> PAID
  reward: 1 GEN; final pool/reserved/pending payout: 0 / 0 / 0
```

The frontend defaults to the final paid V2 instance `0x3ADEDD82008Fd54a0eB9DAA9477743B2b8851008`. Other V2 evidence addresses can still be opened directly from the dashboard. A stale `VITE_DEFAULT_CONTRACT_ADDRESS` pointing at either historical V1 deployment is ignored automatically, so an old Vercel environment value cannot silently become the production default.

## Historical V1 deployments

The previous submission referenced:

```text
0xdD4ecd08d0F23E504b2Bdd6bD1150a5d3C630436
```

A previous browser-test instance was:

```text
0x9d829aF09870Fc4597983E4b0e6AFBBB0ce9B396
```

Those contracts use the old source and **must not be presented as V2 evidence**. V2 changes constructor arguments and settlement behavior.

## Verification status

Local/static gates currently completed:

```text
PASS  Python syntax compilation for contracts/ProofEscrow.py
PASS  V2 structural contract/UI checks (24/24)
PASS  TypeScript syntax transpilation for App.tsx / genlayer.ts / config.ts
```

The contract source SHA-256 for this package is:

```text
73b87f672cee35e7a9d08328ddad7f89767bfbbb04fc9aa1be479e472c85dfa8
```

Fresh StudioNet runtime verification is **PASS** for timeout cancellation, 2-of-2 mutual close, negative adjudication, accepted reservation, and permissionless payout release. Production Vercel verification also confirmed the dedicated landing, create, and paid-dashboard routes against the final V2 instance. Deadline cards are workflow-aware: completed submission/adjudication milestones no longer become red merely because wall-clock time later passes their original cutoffs, while real timeout exits remain explicitly highlighted. See [`TESTING.md`](./TESTING.md).

## Commands

```bash
npm ci
npm run test:v2
npm run test:wallet
npm run build
```

## Tech stack

- GenLayer Intelligent Contracts / GenVM Python
- GenLayer AI-validator consensus
- native GEN settlement
- genlayer-js
- React + TypeScript + Vite
- MetaMask

## Repository structure

```text
ProofEscrow/
├── contracts/ProofEscrow.py
├── scripts/check-v2.mjs
├── src/
│   ├── lib/config.ts
│   ├── lib/errors.ts
│   ├── lib/genlayer.ts
│   ├── App.tsx
│   ├── main.tsx
│   └── styles.css
├── tests/
│   ├── build-test-bundle.mjs
│   └── connect.test.mjs
├── README.md
├── TESTING.md
├── package.json
└── ...
```
