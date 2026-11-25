import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

const isWindows = process.platform === 'win32'
const npxCmd = isWindows ? 'npx.cmd' : 'npx'

const result = spawnSync(npxCmd, ['vitest', 'run', 'tests/worker-d1.integration.test.ts'], {
  cwd: rootDir,
  stdio: 'inherit',
  shell: true,
})

process.exit(result.status ?? 0)
