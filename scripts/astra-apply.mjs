// 把 Astra 回复中每个 "### path" + 代码块写入仓库。usage: node scripts/astra-apply.mjs . <out.md>...
import fs from 'node:fs'
import path from 'node:path'
const [,, root, ...outs] = process.argv
for (const out of outs) {
  const text = fs.readFileSync(out, 'utf8')
  for (const m of text.matchAll(/###\s+`?([\w./-]+\.tsx?)`?\s*\n+```(?:ts|typescript|tsx)?\n([\s\S]*?)\n```/g)) {
    fs.writeFileSync(path.join(root, m[1]), m[2] + '\n')
    console.log('wrote', m[1])
  }
}
