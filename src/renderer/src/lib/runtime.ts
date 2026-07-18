import type { ApiRequest, ApiResponse, Collection, Environment } from '../../../shared/types'
import { buildExecutable } from '../util'
import { runPreRequestScript, runTestScript, type TestResult } from './scripts'

export interface RunResult {
  response: ApiResponse
  tests: TestResult[]
  envUpdates: Record<string, string>
  consoleLines: string[]
  scriptError?: string
}

function toEnv(vars: Record<string, string>): Environment {
  return {
    id: 'runtime',
    name: 'runtime',
    variables: Object.entries(vars).map(([key, value]) => ({ key, value, enabled: true }))
  }
}

/**
 * Send a request applying the full Postman-style script chain:
 *   collection pre-request → request pre-request → send → request test → collection test
 * Variables flow through the whole chain (collection vars < environment < script sets),
 * and collection-level auth is inherited when the request's own auth is "none".
 */
export async function runRequest(
  request: ApiRequest,
  collection: Collection | null,
  baseEnv: Environment | null
): Promise<RunResult> {
  const vars: Record<string, string> = {}
  for (const v of collection?.variables ?? []) if (v.enabled && v.key) vars[v.key] = v.value
  for (const v of baseEnv?.variables ?? []) if (v.enabled && v.key) vars[v.key] = v.value

  const envUpdates: Record<string, string> = {}
  const tests: TestResult[] = []
  const consoleLines: string[] = []
  let scriptError: string | undefined

  const runPre = (script?: string): void => {
    if (!script?.trim()) return
    const out = runPreRequestScript(script, vars)
    Object.assign(vars, out.envUpdates)
    Object.assign(envUpdates, out.envUpdates)
    tests.push(...out.tests)
    consoleLines.push(...out.consoleLines)
    if (out.scriptError && !scriptError) scriptError = out.scriptError
  }
  runPre(collection?.preRequestScript)
  runPre(request.preRequestScript)

  let eff = request
  if (request.auth.type === 'none' && collection?.auth && collection.auth.type !== 'none') {
    eff = { ...request, auth: collection.auth }
  }

  const response = await window.api.sendRequest(buildExecutable(eff, toEnv(vars)))

  const runPost = (script?: string): void => {
    if (!script?.trim() || response.error) return
    const out = runTestScript(script, response, vars)
    Object.assign(vars, out.envUpdates)
    Object.assign(envUpdates, out.envUpdates)
    tests.push(...out.tests)
    consoleLines.push(...out.consoleLines)
    if (out.scriptError && !scriptError) scriptError = out.scriptError
  }
  runPost(request.testScript)
  runPost(collection?.testScript)

  return { response, tests, envUpdates, consoleLines, scriptError }
}
