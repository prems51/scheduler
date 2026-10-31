// scripts/rebuild-node.js
// `npm run rebuild:node` - used before running plain-Node tests.
// better-sqlite3 v13 ships Node-API prebuilds, so the same .node file usually
// serves Node and Electron. Only compile when the check actually fails.

const { spawnSync } = require('child_process')

function loadsInNode() {
  try {
    const Database = require('better-sqlite3')
    const db = new Database(':memory:')
    db.prepare('SELECT 1').get()
    db.close()
    return true
  } catch (error) {
    console.error('[native] ' + (error && error.message ? error.message : error))
    return false
  }
}

if (loadsInNode()) {
  console.log(`[native] better-sqlite3 already loads in Node ${process.versions.node} - no rebuild needed.`)
  process.exit(0)
}

console.log('[native] Rebuilding better-sqlite3 for plain Node...')
const rebuild = spawnSync('npm', ['rebuild', 'better-sqlite3'], {
  stdio: 'inherit',
  shell: true
})
process.exit(rebuild.status === null ? 1 : rebuild.status)
