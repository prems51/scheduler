// scripts/ensure-native.js
// Runs after `npm install` (postinstall).
//
// better-sqlite3 is a native addon. Its prebuilt binaries are Node-API based,
// so one binary can serve both plain Node and Electron. This script checks
// whether the installed binary already loads inside Electron's runtime; if it
// does not, it runs the electron-builder rebuild (the ABI-mismatch case).
//
// Kept as a guard so `npm install` does not fail on PCs without a C++ toolchain
// (node-gyp needs Python + Visual Studio Build Tools) when no rebuild is needed.

const { spawnSync } = require('child_process')

const PROBE = `
  try {
    const Database = require('better-sqlite3')
    const db = new Database(':memory:')
    db.prepare('SELECT 1').get()
    db.close()
    process.exit(0)
  } catch (error) {
    console.error(error && error.message ? error.message : error)
    process.exit(1)
  }
`

function loadsInElectron() {
  let electronBinary
  try {
    electronBinary = require('electron')
  } catch (error) {
    console.error('[native] Electron is not installed yet:', error.message)
    return false
  }

  const result = spawnSync(electronBinary, ['-e', PROBE], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'pipe',
    encoding: 'utf8'
  })
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim()
    if (detail) console.error(detail.split('\n').slice(-3).join('\n'))
  }
  return result.status === 0
}

if (loadsInElectron()) {
  console.log('[native] better-sqlite3 already loads in Electron - no rebuild needed.')
  process.exit(0)
}

console.log('[native] better-sqlite3 does not load in Electron. Rebuilding for Electron...')
const rebuild = spawnSync('npm', ['run', 'rebuild:electron'], {
  stdio: 'inherit',
  shell: true
})
process.exit(rebuild.status === null ? 1 : rebuild.status)
