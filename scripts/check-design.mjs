// Enforces the DESIGN.md rules marked (checked).
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = 'src/renderer/src'
const shared = join(root, 'components/ui')

const files = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : path.endsWith('.tsx') ? [path] : []
  })

const lineOf = (text, index) => text.slice(0, index).split('\n').length
const problems = []

for (const file of files(root)) {
  if (file.startsWith(shared)) continue
  const text = readFileSync(file, 'utf8')
  const at = (index, message) =>
    problems.push(`${relative('.', file)}:${lineOf(text, index)}: ${message}`)

  // Interaction: no native select, checkbox, radio or date/time/number inputs.
  for (const m of text.matchAll(
    /<select\b|type="(checkbox|radio|date|time|datetime-local|number)"/g,
  )) {
    at(m.index, `native control ${m[0]}; use components/ui/`)
  }

  // Copy: button and menu-item labels never end in "…".
  for (const m of text.matchAll(/<(Button|CommandItem|DropdownMenuItem)\b[\s\S]*?<\/\1>/g)) {
    if (m[0].includes('…')) at(m.index, `"…" in a ${m[1]} label`)
  }
}

if (problems.length > 0) {
  console.error('DESIGN.md violations:')
  for (const p of problems) console.error(`  ${p}`)
  process.exit(1)
}
