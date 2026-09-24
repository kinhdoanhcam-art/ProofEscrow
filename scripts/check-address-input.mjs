import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { isAddress } from 'viem'

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')

const helperStart = app.indexOf('export const normalizeAddressInput')
const helperEnd = app.indexOf("type Mode = 'landing'", helperStart)

assert.notEqual(helperStart, -1, 'normalizeAddressInput helper is missing')
assert.notEqual(helperEnd, -1, 'could not isolate address helpers')

const helpers = app.slice(helperStart, helperEnd)
const helperSource = `
  const isAddress = globalThis.__proofEscrowIsAddress
  type Address = \`0x\${string}\`
  ${helpers}
`
const helperJavaScript = ts.transpileModule(helperSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText
globalThis.__proofEscrowIsAddress = isAddress
const helperModule = await import(
  `data:text/javascript;base64,${Buffer.from(helperJavaScript).toString('base64')}`
)
delete globalThis.__proofEscrowIsAddress

const { normalizeAddressInput, toAddress } = helperModule
const checksummed = '0x146e44881d35814bA582D265AF5b97ef2695ec8e'
const lowercase = checksummed.toLowerCase()
const uppercase = `0x${checksummed.slice(2).toUpperCase()}`

const accepted = [
  ['checksummed', checksummed, checksummed],
  ['lowercase', lowercase, lowercase],
  ['uppercase', uppercase, lowercase],
  ['trailing space', `${checksummed} `, checksummed],
  ['leading space', ` ${checksummed}`, checksummed],
  ['newline', `${checksummed}\n`, checksummed],
  ['tab', `${checksummed}\t`, checksummed],
  ['U+00A0', `${checksummed}\u00a0`, checksummed],
  ['U+200B', `${checksummed}\u200b`, checksummed],
  ['U+200C', `${checksummed}\u200c`, checksummed],
  ['U+200D', `${checksummed}\u200d`, checksummed],
  ['U+FEFF', `${checksummed}\ufeff`, checksummed],
  ['embedded whitespace', `${checksummed.slice(0, 12)} ${checksummed.slice(12)}`, checksummed],
]

for (const [name, input, expected] of accepted) {
  assert.equal(toAddress(input), expected, `${name} paste must normalize`)
  console.log(`PASS  ${name.padEnd(20)} -> ${toAddress(input)}`)
}

const rejected = [
  ['short address', '0x123'],
  ['non-hex character', `${lowercase.slice(0, -1)}z`],
  ['missing 0x prefix', lowercase.slice(2)],
  ['empty input', ''],
]

for (const [name, input] of rejected) {
  assert.equal(toAddress(input), null, `${name} must be rejected`)
  console.log(`PASS  ${name.padEnd(20)} -> rejected`)
}

assert.equal(
  normalizeAddressInput(`${checksummed}\u00a0\u200b\n`),
  checksummed,
  'normalizer must remove visible and invisible pasted whitespace',
)

assert.match(app, /const savedAddress = toAddress\(saved\)/)
assert.match(app, /const target = toAddress\(loadAddress\)/)
assert.match(app, /const cleanWorker = toAddress\(worker\)/)
assert.match(app, /worker: cleanWorker/)
assert.match(app, /const target = toAddress\(recoveryAddress\)/)
assert.ok(!app.includes('worker: worker as Address'), 'raw Worker input must never be deployed')
assert.ok(!app.includes('isAddress(loadAddress)'), 'raw load input must not be validated directly')
assert.ok(!app.includes('isAddress(recoveryAddress)'), 'raw recovery input must not be validated directly')

console.log(`\nPASS  all ${accepted.length + rejected.length} functional address cases`)
console.log('PASS  all four pasted-address paths use the shared parser')
