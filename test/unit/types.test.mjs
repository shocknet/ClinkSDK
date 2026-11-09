import { it } from 'node:test'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

it('typechecks public noffer payer-data and recovery types', () => {
  execFileSync(process.execPath, [
    fileURLToPath(new URL('../../node_modules/typescript/bin/tsc', import.meta.url)),
    '--noEmit', '--strict', '--skipLibCheck', '--target', 'ES2020', '--module', 'ES2020',
    '--moduleResolution', 'node',
    fileURLToPath(new URL('../types/noffer.ts', import.meta.url)),
  ], { stdio: 'pipe' })
})
