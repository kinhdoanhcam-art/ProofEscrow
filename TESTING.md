# ProofEscrow — Testing Guide

## Current Contract

```text
0xdD4ecd08d0F23E504b2Bdd6bD1150a5d3C630436
```

Explorer:

https://explorer-studio.genlayer.com/address/0xdD4ecd08d0F23E504b2Bdd6bD1150a5d3C630436

GitHub:

https://github.com/kinhdoanhcam-art/ProofEscrow

## Validation Coverage

The same escrow logic has previously been validated for:

```text
✓ exact native GEN funding
✓ Client-only funding
✓ Worker-only evidence submission
✓ evidence URL persistence
✓ consensus-reviewed snapshot
✓ ACCEPTED adjudication
✓ reward reservation
✓ Worker withdrawal
✓ REJECTED adjudication
✓ Client refund
✓ resubmission after rejection
✓ maximum-attempt tracking
✓ final escrow accounting
✓ RPC-safe frontend behavior
```

The current deployment uses the same validated contract logic.

## Minimal Positive Flow

```text
1. fund()
2. submit_deliverable()
3. commit_reviewed_snapshot()
4. adjudicate()
5. withdraw()
```

Wait for each write to reach `FINALIZED`.

## Expected Positive Accounting

After funding:

```text
pool = reward
reserved = 0
pending payout = 0
```

After acceptance:

```text
status = ACCEPTED_RESERVED
pool = reward
reserved = reward
pending payout = reward
```

After withdrawal:

```text
status = PAID
pool = 0
reserved = 0
pending payout = 0
```

## Rejected / Refund Path

```text
fund
→ submit_deliverable
→ commit_reviewed_snapshot
→ adjudicate
→ REJECTED
→ refund
→ REFUNDED
```

## Resubmission

With `max_attempts = 2`:

```text
FUNDED
→ SUBMITTED (1/2)
→ SNAPSHOT_COMMITTED
→ REJECTED
→ SUBMITTED (2/2)
→ SNAPSHOT_COMMITTED
→ ACCEPTED_RESERVED
→ PAID
```

## Authorization Checks

Expected failures:

```text
non-Client → fund()
non-Worker → submit_deliverable()
non-Worker → withdraw()
non-Client → refund()
```

## Wrong-State Checks

Expected failures:

```text
submit before FUNDED
commit snapshot before SUBMITTED
adjudicate before SNAPSHOT_COMMITTED
withdraw before ACCEPTED_RESERVED
refund before REJECTED
```

## RPC Safety

If a write already returned a transaction hash, the frontend does not automatically resend that write just because receipt monitoring fails. Refresh contract state first.

## Low-RPC Recommendation

To conserve StudioNet quota, do not repeat full testing unless needed. For one positive verification:

```text
fund → submit → snapshot → adjudicate → withdraw
```
