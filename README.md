# ProofEscrow

**AI-adjudicated work escrow with deterministic native GEN settlement on GenLayer.**

ProofEscrow is a full-stack GenLayer dApp that connects qualitative deliverable review with deterministic escrow settlement. A Client defines a natural-language specification, Worker address, reward, and maximum attempts. The Client funds the escrow in native GEN. The Worker submits public evidence, GenLayer validators build a consensus-reviewed factual snapshot, and a separate adjudication stage determines whether the work satisfies the locked specification.

## Why GenLayer?

The difficult question is subjective:

> Does the submitted evidence actually demonstrate that the Worker satisfied every material requirement?

GenLayer provides decentralized AI-validator consensus for that qualitative step, while ProofEscrow keeps funding, authorization, accounting, retries, withdrawal, refund, and state transitions deterministic.

## State Machine

```text
OPEN
  ↓ fund()
FUNDED
  ↓ submit_deliverable()
SUBMITTED
  ↓ commit_reviewed_snapshot()
SNAPSHOT_COMMITTED
  ↓ adjudicate()

        ┌─────────────────────┐
        ▼                     ▼
ACCEPTED_RESERVED          REJECTED
        │                     │
        │ withdraw()          ├─ resubmit if attempts remain
        ▼                     └─ refund()
      PAID                       ↓
                              REFUNDED
```

## Two-Stage AI Review

### Stage 1 — Consensus-Reviewed Snapshot

Validators inspect Worker evidence and produce a factual snapshot containing fetch status, exact source URL, summary, observable facts, and limitations. The snapshot records evidence; it does not make the final verdict.

### Stage 2 — Adjudication

Final adjudication uses only:

```text
Locked Specification
+
Committed Reviewed Snapshot
```

The evidence URL is not fetched again during final judgment. The result becomes `ACCEPTED` or `REJECTED` with rationale and failed requirements.

## Deterministic Escrow Logic

ProofEscrow deterministically enforces Client/Worker identities, immutable specification, exact reward amount, Client-only funding, Worker-only evidence submission, bounded attempts, pool/reserved/pending accounting, Worker withdrawal, Client refund, and one-way settlement states.

## Accepted Settlement

```text
status          = ACCEPTED_RESERVED
reserved        = reward
pending_payout  = reward
```

The Worker calls `withdraw()`. After withdrawal:

```text
status          = PAID
pool            = 0
reserved        = 0
pending_payout  = 0
```

## Rejected Settlement

```text
status          = REJECTED
pool            = reward
reserved        = 0
pending_payout  = 0
```

If attempts remain, the Worker may submit replacement evidence. The Client may call `refund()` from the rejected state.

## RPC Reliability

StudioNet can occasionally rate-limit or temporarily fail receipt requests. The frontend separates submission from finalization monitoring and uses bounded retry/backoff. Once a write returns a transaction hash, the UI does not automatically submit the same write again merely because receipt monitoring later fails.

## Validation

The unchanged escrow logic has been validated across the principal flows:

```text
✓ native GEN funding
✓ Worker evidence submission
✓ consensus-reviewed snapshot
✓ ACCEPTED adjudication
✓ reward reservation
✓ Worker withdrawal
✓ REJECTED adjudication
✓ Client refund
✓ rejected-work resubmission
✓ maximum-attempt tracking
✓ final accounting
✓ RPC-safe write handling
```

The current deployment is a redeployment of the same validated contract logic.

## Current Deployment

```text
0xdD4ecd08d0F23E504b2Bdd6bD1150a5d3C630436
```

Explorer:

https://explorer-studio.genlayer.com/address/0xdD4ecd08d0F23E504b2Bdd6bD1150a5d3C630436

## GitHub

https://github.com/kinhdoanhcam-art/ProofEscrow

## Tech Stack

- GenLayer Intelligent Contracts
- GenVM / Python
- GenLayer AI-validator consensus
- genlayer-js
- React
- TypeScript
- Vite
- MetaMask
- native GEN settlement

## Repository Structure

```text
ProofEscrow/
├── contracts/
│   └── ProofEscrow.py
├── src/
│   ├── lib/
│   │   ├── config.ts
│   │   └── genlayer.ts
│   ├── App.tsx
│   ├── main.tsx
│   └── styles.css
├── .env.example
├── README.md
├── TESTING.md
├── ProofEscrow_Submission_Note.txt
├── package.json
└── vite.config.ts
```

## Status

**Deployed on GenLayer StudioNet.**
