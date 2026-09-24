# ProofEscrow — Worker Address Fix Evidence

## Steward request

The production frontend blocked escrow creation with:

```text
Worker address is invalid.
```

The contract was not the source of the failure. The frontend called viem's
`isAddress()` on raw pasted text. Valid addresses copied from a web page can
carry a trailing space, newline, tab, non-breaking space, byte-order mark, or
zero-width character, causing validation to fail before the transaction is
built.

## Implemented correction

`src/App.tsx` now has one shared address parser:

1. remove whitespace, U+00A0, U+200B–U+200D, and U+FEFF;
2. validate with viem's `isAddress()`;
3. when a 40-hex-character address has non-canonical casing, normalize it to
   lowercase and validate again; and
4. reject wrong-length, missing-prefix, or non-hex values.

The normalized value is used for both validation and the operation. No raw
Worker value is sent after a different value was checked.

The shared parser is applied to all four pasted-address paths:

- Worker address during escrow creation;
- Open escrow contract address;
- post-deploy recovery address; and
- last contract address restored from local storage.

Source locations in the completed `src/App.tsx`:

| Location | Lines | Normalized value used |
| --- | ---: | --- |
| shared normalizer/parser | 23–42 | `normalizeAddressInput()` / `toAddress()` |
| local-storage restoration | 283–288 | `savedAddress` |
| Open escrow | 413–423 | `target` |
| Worker creation | 436–478 | `cleanWorker` passed to `deployEscrow()` |
| post-deploy recovery | 497–503 | `target` |

There is no remaining `worker: worker as Address`, `isAddress(loadAddress)`, or
`isAddress(recoveryAddress)` path in the frontend.

## Automated evidence

```bash
npm ci
npm test
npm run build
```

Observed results:

```text
PASS  address normalization: 17 functional cases, 0 failed
PASS  all four pasted-address paths use the shared parser
PASS  V2 source/config checks: 24 checks, 0 failed
PASS  wallet connection checks: 15 checks, 0 failed
PASS  TypeScript and Vite production build
```

The address matrix includes checksummed, lowercase, uppercase, leading and
trailing spaces, newline, tab, NBSP, zero-width characters, BOM, and embedded
whitespace. The negative cases `0x123`, a non-hex character, missing `0x`, and
empty input are still rejected.

## Contract integrity

`contracts/ProofEscrow.py` is unchanged.

```text
SHA-256: 73b87f672cee35e7a9d08328ddad7f89767bfbbb04fc9aa1be479e472c85dfa8
StudioNet: 0x3ADEDD82008Fd54a0eB9DAA9477743B2b8851008
```

No contract redeployment is required.

## Public deployment verification

After the frontend commit is deployed to Vercel, verify the Worker field, Open
escrow field, and recovery field with a normal address plus trailing space,
NBSP/zero-width paste artifacts, lowercase, and uppercase variants. Confirm
that `0x123` still produces the improved invalid-address message. This manual
public-deployment check is intentionally left unclaimed until the new frontend
is live.

## Steward response

Thank you for catching this, and apologies for the wall you hit.

The failure was in the frontend, not the contract. `src/App.tsx` validated the
pasted Worker address with viem's `isAddress()` on the raw input value, with no
normalization. A paste carrying a trailing space, newline, tab, NBSP, or
zero-width character was rejected before the transaction could be built.

Address input is now normalized once before validation, and the normalized
value is what the app sends or stores. The same correction covers the other
pasted-address paths, including the post-deploy recovery field that explicitly
instructs users to copy an address from Explorer. Valid all-uppercase or
non-canonical casing is normalized to lowercase; malformed length or non-hex
input remains rejected.

`contracts/ProofEscrow.py` is unchanged at SHA-256
`73b87f672cee35e7a9d08328ddad7f89767bfbbb04fc9aa1be479e472c85dfa8`,
and the deployment at `0x3ADEDD82008Fd54a0eB9DAA9477743B2b8851008`
is untouched. No redeployment was needed.
