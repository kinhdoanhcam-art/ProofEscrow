// Run with:
//   node tests/build-test-bundle.mjs && node tests/connect.test.mjs
//
// Proves the steward's exact failure is gone: a wallet that does not support the
// GenLayer Snap must still connect.

import { connectWallet, ensureStudioChain, STUDIO_CHAIN_ID_HEX } from './.genlayer.mjs'

const ACCOUNT = '0x1111111111111111111111111111111111111111'
let pass = 0, fail = 0
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('PASS  ' + name) }
  else { fail++; console.log('FAIL  ' + name + '  ' + detail) }
}

/** Fake MetaMask. `behaviour` decides how each RPC method responds. */
function installWallet(behaviour) {
  const calls = []
  globalThis.window = {
    ethereum: {
      request: async ({ method }) => {
        calls.push(method)
        const handler = behaviour[method]
        if (typeof handler === 'function') return handler()
        if (handler !== undefined) return handler
        return null
      },
    },
  }
  return calls
}

const onStudio = { eth_chainId: STUDIO_CHAIN_ID_HEX, eth_requestAccounts: [ACCOUNT] }
const reject = (code, message) => () => { const e = new Error(message); e.code = code; throw e }

// ---- 1. THE STEWARD'S CASE: wallet has no Snap support --------------------
{
  const calls = installWallet({
    ...onStudio,
    wallet_getSnaps: reject(-32601, 'The method does not exist.'),
  })

  let result, threw
  try { result = await connectWallet() } catch (e) { threw = e }

  check('no-Snap wallet: connectWallet does NOT throw', !threw, String(threw?.message))
  check('no-Snap wallet: account is returned', result?.address === ACCOUNT, JSON.stringify(result))
  check('no-Snap wallet: no blocking warning', result?.warning === undefined, String(result?.warning))
  check('no-Snap wallet: snap step was actually attempted', calls.includes('wallet_getSnaps'))
}

// ---- 2. User dismisses the Snap install prompt ---------------------------
{
  installWallet({
    ...onStudio,
    wallet_getSnaps: {},                       // supported, nothing installed
    wallet_requestSnaps: reject(4001, 'User rejected the request.'),
  })

  let result, threw
  try { result = await connectWallet() } catch (e) { threw = e }

  check('dismissed Snap prompt: still connects', !threw && result?.address === ACCOUNT, String(threw?.message))
}

// ---- 3. Wrong chain, wallet switches cleanly -----------------------------
{
  let chain = '0x1'
  const calls = installWallet({
    eth_requestAccounts: [ACCOUNT],
    eth_chainId: () => chain,
    wallet_switchEthereumChain: () => { chain = STUDIO_CHAIN_ID_HEX; return null },
    wallet_getSnaps: {},
    wallet_requestSnaps: null,
  })

  const result = await connectWallet()
  check('wrong chain: switch was requested', calls.includes('wallet_switchEthereumChain'))
  check('wrong chain: connects with no warning', result.address === ACCOUNT && result.warning === undefined, String(result.warning))
}

// ---- 4. Chain unknown to the wallet (4902) -> add, then switch -----------
{
  let known = false
  const calls = installWallet({
    eth_requestAccounts: [ACCOUNT],
    eth_chainId: '0x1',
    wallet_switchEthereumChain: () => {
      if (!known) { const e = new Error('Unrecognized chain ID.'); e.code = 4902; throw e }
      return null
    },
    wallet_addEthereumChain: () => { known = true; return null },
    wallet_getSnaps: {},
    wallet_requestSnaps: null,
  })

  const result = await connectWallet()
  check('unknown chain: wallet_addEthereumChain was called', calls.includes('wallet_addEthereumChain'))
  check('unknown chain: connects', result.address === ACCOUNT)
}

// ---- 5. User rejects the network switch ----------------------------------
{
  installWallet({
    eth_requestAccounts: [ACCOUNT],
    eth_chainId: '0x1',
    wallet_switchEthereumChain: reject(4001, 'User rejected the request.'),
    wallet_getSnaps: () => { throw new Error('snap step must not run after a chain rejection') },
  })

  const result = await connectWallet()
  check('rejected switch: still returns the account', result.address === ACCOUNT)
  check('rejected switch: surfaces a warning', typeof result.warning === 'string' && result.warning.length > 0)
  check('rejected switch: does NOT re-prompt for the Snap', !result.warning?.includes('must not run'))
}

// ---- 6. Account request itself rejected -> this IS a real failure --------
{
  installWallet({ eth_chainId: STUDIO_CHAIN_ID_HEX, eth_requestAccounts: reject(4001, 'User rejected the request.') })

  let threw
  try { await connectWallet() } catch (e) { threw = e }
  check('rejected account request: does throw', Boolean(threw))
}

// ---- 7. ensureStudioChain is a no-op when already on Studio -------------
{
  const calls = installWallet(onStudio)
  await ensureStudioChain()
  check('already on Studio: no switch/add prompt', !calls.includes('wallet_switchEthereumChain') && !calls.includes('wallet_addEthereumChain'))
  check('already on Studio: no Snap call from ensureStudioChain', !calls.includes('wallet_getSnaps'))
}

console.log(`\nTOTAL: ${pass + fail} checks, ${fail} failed`)
process.exit(fail ? 1 : 0)
