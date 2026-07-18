// Standalone smoke test of the CDP capture logic used in src/main/cdp.ts
import CDP from 'chrome-remote-interface'
import { spawn } from 'child_process'

const PORT = 9223
const chrome = spawn(
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  [
    `--remote-debugging-port=${PORT}`,
    '--headless=new',
    '--user-data-dir=/tmp/cdp-test-profile',
    '--no-first-run',
    'about:blank'
  ],
  { stdio: 'ignore' }
)

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

try {
  let version = null
  for (let i = 0; i < 15; i++) {
    await wait(500)
    try {
      version = await CDP.Version({ port: PORT })
      break
    } catch {}
  }
  if (!version) throw new Error('Chrome debug port never came up')
  console.log('Chrome:', version.Browser)

  const targets = await CDP.List({ port: PORT })
  const page = targets.find((t) => t.type === 'page')
  const client = await CDP({ port: PORT, target: page.id })
  const { Network, Page } = client

  const records = new Map()
  Network.requestWillBeSent((p) =>
    records.set(p.requestId, { url: p.request.url, method: p.request.method })
  )
  Network.responseReceived((p) => {
    const r = records.get(p.requestId)
    if (r) r.status = p.response.status
  })
  const finished = []
  Network.loadingFinished((p) => finished.push(p.requestId))

  await Network.enable()
  await Page.enable()
  await Page.navigate({ url: 'https://example.com' })
  await Page.loadEventFired()
  await wait(500)

  console.log('Captured requests:', records.size)
  for (const [id, r] of records) {
    console.log(` ${r.method} ${r.status ?? '?'} ${r.url}`)
    if (finished.includes(id)) {
      const { body } = await Network.getResponseBody({ requestId: id })
      console.log(`   body: ${body.length} chars, starts: ${body.slice(0, 60).replace(/\n/g, ' ')}`)
    }
  }
  await client.close()
  console.log(records.size > 0 ? 'CDP_TEST_PASS' : 'CDP_TEST_FAIL')
} finally {
  chrome.kill()
}
