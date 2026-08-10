import { readdirSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const root = dirname(fileURLToPath(import.meta.url))

function walk(dir, base = dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.vitepress' || name === 'en') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p, base))
    else if (name.endsWith('.md')) out.push(p.slice(base.length + 1).replaceAll('\\', '/'))
  }
  return out
}

const zhPages = walk(root)
const missing = zhPages.filter((rel) => !existsSync(join(root, 'en', rel)))
if (missing.length) {
  console.error('Missing English docs for:', missing.join(', '))
  process.exit(1)
}
console.log(`docs i18n ok: ${zhPages.length} zh pages mirrored under en/`)
