// 调用协作者 Astra（GPT-6 Astra，OpenAI 兼容接口）。系统提示见 scripts/astra-system.md
// usage: ASTRA_API_KEY=... node scripts/astra.mjs <promptFile> <outFile> [model]
// 多个任务可并行：每个任务各起一个进程
import fs from 'node:fs'

const [, , promptFile, outFile, model = 'gpt-6-astra'] = process.argv
const base = process.env.ASTRA_BASE_URL ?? 'http://20.78.57.41:18317/v1'
const system = fs.readFileSync(new URL('./astra-system.md', import.meta.url), 'utf8')

const t0 = Date.now()
const res = await fetch(`${base}/chat/completions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.ASTRA_API_KEY}` },
  body: JSON.stringify({
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: fs.readFileSync(promptFile, 'utf8') }
    ]
  })
})
const json = await res.json()
fs.writeFileSync(outFile, json.choices?.[0]?.message?.content ?? JSON.stringify(json, null, 2))
console.log(`${res.status} ${model} ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${outFile}`)
