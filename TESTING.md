# ProofEscrow — Testing

## Current Deployment

**Network:** GenLayer StudioNet

**Contract**

```text
0xdD4ecd08d0F23E504b2Bdd6bD1150a5d3C630436
```

**Explorer**

https://explorer-studio.genlayer.com/address/0xdD4ecd08d0F23E504b2Bdd6bD1150a5d3C630436

**Live App**

https://proof-escrow-bay.vercel.app/

**GitHub**

https://github.com/kinhdoanhcam-art/ProofEscrow

## Scope of This Re-Test

The steward-feedback fix is frontend/docs only. `contracts/ProofEscrow.py` and the deployed base contract address above were not changed for this fix.

The browser tests below record only what was actually observed after the updated frontend was deployed.

---

## Build — PASS

Command:

```bash
npm run build
```

Observed:

```text
vite v6.4.3 building for production...
476 modules transformed.
built in 3.40s
```

Result:

```text
PASS
```

The chunk-size message was a Vite optimization warning, not a build failure.

---

## Test 1 — Create Job — PASS

Client wallet:

```text
0x3065E31B1D993d7C0D59E6786844cBa56780B2d3
```

Worker wallet:

```text
0x5a52d040581A76e2C032542855D31480f2ea7097
```

Input:

```text
Job title:
Landing Page Design

Locked acceptance specification:
Worker must deliver a responsive landing page with desktop and mobile layouts, source files, and a public preview link.

Reward:
5 GEN

Max submission attempts:
2
```

Observed after wallet confirmation:

```text
status: OPEN
reward: 5 GEN
attempt: 0/2
role: CLIENT
pool: 0 GEN
reserved: 0 GEN
pending payout: 0 GEN
```

The new escrow loaded into the app successfully and appeared in `Your recent escrows`.

Result:

```text
PASS
```

This directly verifies that the steward's original Create Job flow no longer ends in `[object Object]` on the successful path.

---

## Test 2 — Reject MetaMask Request — PASS

Input:

```text
Job title:
Reject Test

Specification:
This is a temporary test job used only to verify wallet rejection handling.

Reward:
1 GEN

Max submission attempts:
1
```

Action:

```text
Deploy Escrow
→ Reject transaction signature in MetaMask
```

Observed user-facing error:

```text
User rejected the request.
Details: MetaMask Tx Signature:
User denied transaction signature.
Version: viem@2.55.13
```

Important result:

```text
[object Object]
```

was **not** displayed.

Result:

```text
PASS
```

Note: the current message is functionally correct but still includes viem detail text. This is acceptable for the steward fix; future polish could keep only the friendly sentence in the toast and leave raw detail in the console.

---

## Test 3 — Specification Length Guard — PASS

A clipboard string of 2101 characters was pasted into:

```text
Locked acceptance specification
```

Observed counter:

```text
2000 / 2000
```

The field did not accept content beyond the contract limit.

Result:

```text
PASS
```

This verifies the frontend guard for `MAX_SPEC_LENGTH = 2000`.

Title and evidence URL limits are implemented in the UI, but were not separately stress-tested in this browser run, so they are not marked PASS here.

---

## Test 4 — Error Toast Dismissal — PASS

A MetaMask rejection was triggered to display an error toast.

Observed:

- error toast rendered in the lower-right area;
- toast showed a visible `×` close control;
- clicking `×` removed the toast immediately;
- the page did not reload;
- form contents remained intact.

Result:

```text
PASS
```

Long-error scrolling and informational auto-dismiss timing were not intentionally stress-tested in this run.

---

## Test 5 — Worker Role UX — PASS

The connected wallet was changed to the Worker:

```text
0x5a52d040581A76e2C032542855D31480f2ea7097
```

The `Landing Page Design` escrow was opened.

Observed:

```text
role badge: WORKER
status: OPEN
reward: 5 GEN
```

The Client-only action remained visible:

```text
Fund 5 GEN
```

but was disabled.

The UI displayed the reason:

```text
Only the client may fund.
```

Result:

```text
PASS
```

This verifies the new role badge and disabled-with-reason behavior.

---

## Recent Escrows — Observed

After creating `Landing Page Design`, the app displayed it in:

```text
Your recent escrows
```

alongside the previously known escrow.

This confirms the recent-job UI rendered the newly created escrow during this browser session.

A separate browser/session persistence test was not performed, so cross-session persistence is not separately claimed.

---

## Verified Summary

```text
PASS  npm run build
PASS  Create Job
PASS  Created escrow loaded successfully
PASS  Newly created escrow shown in Recent Escrows
PASS  MetaMask rejection no longer shows [object Object]
PASS  2000-character specification limit
PASS  Error toast can be dismissed
PASS  WORKER role badge
PASS  Client-only Fund button disabled for Worker
PASS  Disabled-action explanation
```

## Not Yet Re-Verified in This Browser Run

The following are intentionally **not** marked PASS:

```text
- forced submitted-but-unconfirmed deployment recovery
- manual address recovery after deliberately failing receipt monitoring
- informational toast auto-dismiss timing
- long-error scroll behavior under an oversized provider/RPC message
- title 160-character stress test
- evidence URL 1000-character stress test
- full funded settlement path:
  fund
  → submit_deliverable
  → commit_reviewed_snapshot
  → adjudicate
  → withdraw

- rejected/refund path:
  fund
  → submit_deliverable
  → commit_reviewed_snapshot
  → adjudicate
  → REJECTED
  → refund
```

These should only be marked PASS after an actual run on the current deployment/frontend.

## RPC Safety Rule

Once `deployContract` or `writeContract` returns a transaction hash, the frontend must **never automatically send the same transaction again** merely because receipt monitoring fails.

Use the existing transaction hash, Explorer/recovery UI, and state refresh instead.
