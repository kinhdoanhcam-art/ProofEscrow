# ProofEscrow — Testing Guide

## Current Contract

```text
0xdD4ecd08d0F23E504b2Bdd6bD1150a5d3C630436
```

Explorer:

https://explorer-studio.genlayer.com/address/0xdD4ecd08d0F23E504b2Bdd6bD1150a5d3C630436

GitHub:

https://github.com/kinhdoanhcam-art/ProofEscrow

## Important Testing Status

The current contract remains unchanged during this steward-feedback fix.

This update changes the frontend error handling, deployment recovery flow, and UI/UX only. Do **not** treat older deployments or earlier runs as proof that this exact frontend revision has passed the browser flow.

### Verified before this fix

```text
- npm install completed successfully on the reviewed source
- npm run build passed on the pre-fix source
- ProofEscrow.py parsed successfully as Python
- genlayer-js@1.1.8 deployment/write/receipt code was inspected directly
```

### Must be re-tested after applying this fix

```text
[ ] Create Job with a valid wallet and inputs
[ ] Reject a wallet request and confirm a readable message is shown
[ ] Confirm a submitted deploy never loses its transaction hash
[ ] Confirm the created contract address is loaded when ACCEPTED receipt exposes it
[ ] Confirm manual address recovery works when receipt monitoring cannot recover the address
[ ] Confirm >2000-character specification is blocked before submission
[ ] Confirm toast can be dismissed
[ ] Confirm recent-job list can reload a saved escrow
[ ] Confirm role badge and disabled-with-reason action controls render correctly
[ ] npm run build on the final pushed source
```

## Required Re-test — 5 Steps

### 1. Create Job — normal path

**Input**

- valid Client wallet
- valid Worker address
- title <= 160 characters
- specification <= 2000 characters
- positive GEN reward
- attempts between 1 and 5

**Expected**

```text
Submitting to wallet
→ Waiting for consensus
→ contract address recovered from ACCEPTED receipt
→ app loads the new escrow
```

The address must be persisted in the recent-job list and `LAST_CONTRACT_KEY`.

Do not redeploy merely because later state refresh is delayed.

### 2. Reject the wallet request

Start Create Job, then press **Reject** in MetaMask / the wallet prompt.

**Expected**

A readable message such as:

```text
You rejected the request in your wallet.
```

The UI must never display:

```text
[object Object]
```

Open the browser console and confirm the raw provider error is also logged for debugging.

### 3. Client-side length guard

Paste a specification longer than 2000 characters.

**Expected**

The textarea is capped at 2000 characters and displays a live counter.
No deployment transaction is submitted for an oversized specification.

Also confirm:

```text
Job title <= 160 characters
Evidence URL <= 1000 characters
```

### 4. Toast / recovery UX

Trigger a visible error.

**Expected**

- toast has a close button;
- long text scrolls instead of covering the app;
- informational notices auto-dismiss after roughly 6 seconds;
- submitted-but-unconfirmed notices remain visible;
- if a deploy hash exists but the address cannot be recovered, the Create page shows the Explorer link and manual address-recovery field.

### 5. Final build

```bash
npm install
npm run build
```

**Expected**

```text
PASS
```

Record the actual result here only after running it on the final source.

## Contract Flow — Not Re-claimed Here

The escrow contract exposes the following intended positive flow:

```text
fund
→ submit_deliverable
→ commit_reviewed_snapshot
→ adjudicate
→ withdraw
```

and rejected/refund flow:

```text
fund
→ submit_deliverable
→ commit_reviewed_snapshot
→ adjudicate
→ REJECTED
→ refund
```

These flows should be marked PASS for the current deployment only after they are actually executed and observed on that deployment.

## RPC Safety

Once `deployContract` or `writeContract` returns a transaction hash, the frontend must **never automatically send the same transaction again** just because receipt monitoring fails.

Use the transaction hash, Explorer, manual address recovery, and state refresh instead.
