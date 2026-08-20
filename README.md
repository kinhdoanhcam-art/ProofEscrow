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

StudioNet can occasionally rate-limit or temporarily fail receipt requests. The frontend separates submission from receipt monitoring and uses bounded retry/backoff. Once a write returns a transaction hash, the UI does not automatically submit the same write again merely because receipt monitoring later fails.

For deployment, the frontend waits for an `ACCEPTED` receipt so the new contract address can be recovered sooner. If receipt monitoring cannot recover the address, the transaction hash remains available with an Explorer/recovery path instead of automatically deploying again.

## Steward Feedback Fix

The Aug 2026 steward feedback reported:

```text
Creating a job shows this error [object Object]
please work on your UI/UX
```

The frontend/docs update addresses that feedback without changing the deployed contract.

Changes include:

- plain-object wallet/RPC errors are normalized instead of rendering `[object Object]`;
- raw provider errors are logged to the browser console for debugging;
- deployment waits for `ACCEPTED` instead of requiring long `FINALIZED` monitoring before recovering the address;
- submitted deployments preserve the transaction hash and expose recovery UI;
- transaction progress is shown in stages;
- create inputs mirror the contract's text limits and show live counters;
- toasts are dismissible and long error content is scrollable;
- recent escrows are stored locally;
- the connected role is shown as `CLIENT`, `WORKER`, or `OBSERVER`;
- role-restricted actions remain visible but disabled with an explanation.

## Verified Frontend Re-Test

The final steward-fix frontend was tested in the browser against StudioNet.

Verified:

```text
PASS  npm run build
PASS  Create Job with valid inputs
PASS  Newly created escrow address loaded into the app
PASS  Newly created escrow appeared in Recent Escrows
PASS  MetaMask Reject produced a readable error instead of [object Object]
PASS  Specification input capped at 2000 / 2000
PASS  Error toast could be closed with ×
PASS  WORKER role badge rendered for the Worker wallet
PASS  Client-only Fund action stayed visible but disabled for Worker
PASS  Disabled action displayed: "Only the client may fund."
```

Not claimed as browser-verified in this re-test:

```text
- manual recovery after an intentionally forced receipt-monitoring failure
- informational toast auto-dismiss timing
- long-error scrolling under an intentionally oversized RPC error
- full fund → submit → snapshot → adjudicate → withdraw/refund settlement flow
```

See [`TESTING.md`](./TESTING.md) for the exact observed test record.

## Current Deployment

```text
0xdD4ecd08d0F23E504b2Bdd6bD1150a5d3C630436
```

Explorer:

https://explorer-studio.genlayer.com/address/0xdD4ecd08d0F23E504b2Bdd6bD1150a5d3C630436

## Live App

https://proof-escrow-bay.vercel.app/

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
│   │   ├── errors.ts
│   │   └── genlayer.ts
│   ├── App.tsx
│   ├── main.tsx
│   └── styles.css
├── README.md
├── TESTING.md
├── package.json
├── package-lock.json
├── tsconfig.app.json
├── tsconfig.json
├── vite.config.ts
└── index.html
```

## Status

**Deployed on GenLayer StudioNet. Steward-feedback frontend fix re-tested and ready for resubmission.**
