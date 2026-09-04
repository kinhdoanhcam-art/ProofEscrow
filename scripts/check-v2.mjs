import fs from 'node:fs'
import crypto from 'node:crypto'

const contract = fs.readFileSync('contracts/ProofEscrow.py', 'utf8')
const app = fs.readFileSync('src/App.tsx', 'utf8')
const config = fs.readFileSync('src/lib/config.ts', 'utf8')

let pass = 0
let fail = 0
const check = (name, condition) => {
  if (condition) { pass += 1; console.log(`PASS  ${name}`) }
  else { fail += 1; console.log(`FAIL  ${name}`) }
}

check('contract exposes v2 config', contract.includes('"version": "2.0"'))
check('submission deadline stored on-chain', contract.includes('submission_deadline_unix: u256'))
check('adjudication deadline stored on-chain', contract.includes('adjudication_deadline_unix: u256'))
check('deadline clock uses deterministic tx time', contract.includes('datetime.now(timezone.utc).timestamp()'))
check('fund blocks after submission deadline', contract.includes('Submission deadline has passed'))
check('snapshot/adjudication blocks after final deadline', contract.includes('Adjudication deadline has passed'))
check('deadline cancellation path exists', contract.includes('def cancel_after_deadline'))
check('mutual close path exists', contract.includes('def approve_mutual_close'))
check('mutual close requires both approvals', contract.includes('self.client_close_approved and self.worker_close_approved'))
check('accepted payout has permissionless release', contract.includes('def release_reserved_payout'))
check('timeout terminal state exists', contract.includes('CANCELLED_TIMEOUT'))
check('mutual close terminal state exists', contract.includes('MUTUALLY_CLOSED'))
check('frontend has dedicated landing route', app.includes("type Mode = 'landing' | 'create' | 'dashboard'"))
check('frontend uses hash routes', app.includes("window.location.hash"))
check('create page collects submission deadline', app.includes('Submission deadline'))
check('create page collects adjudication deadline', app.includes('Adjudication deadline'))
check('dashboard exposes deadline cancellation', app.includes('Cancel after deadline'))
check('dashboard exposes mutual close', app.includes('Approve mutual close'))
check('terminal deadline cards avoid false expired warnings', app.includes("Adjudication completed · payout released") && app.includes("Submission completed"))
check('timeout deadline cards remain explicit', app.includes("timeout exit triggered"))
check('dashboard truncates addresses', app.includes('<AddressValue value={job.summary.client}'))
check('final paid V2 address is the fallback default', config.includes('0x3ADEDD82008Fd54a0eB9DAA9477743B2b8851008'))
check('historical V1 addresses are explicitly denied', config.includes('HISTORICAL_V1_ADDRESSES') && config.includes('0xdD4ecd08d0F23E504b2Bdd6bD1150a5d3C630436') && config.includes('0x9d829aF09870Fc4597983E4b0e6AFBBB0ce9B396'))
check('stale environment default falls back safely', config.includes('configuredDefaultIsSafe ? configuredDefault : FALLBACK_CONTRACT_ADDRESS'))

const hash = crypto.createHash('sha256').update(contract).digest('hex')
console.log(`\nSOURCE SHA256: ${hash}`)
console.log(`TOTAL: ${pass + fail} checks, ${fail} failed`)
process.exit(fail ? 1 : 0)
