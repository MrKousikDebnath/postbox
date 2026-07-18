import type { ApiResponse } from '../../../shared/types'

export interface TestResult {
  name: string
  passed: boolean
  error?: string
}

export interface ScriptOutcome {
  tests: TestResult[]
  envUpdates: Record<string, string>
  consoleLines: string[]
  scriptError?: string
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value)
  if (value === undefined) return 'undefined'
  try {
    const json = JSON.stringify(value)
    return json === undefined ? String(value) : json
  } catch {
    return String(value)
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const aKeys = Object.keys(a as Record<string, unknown>)
  const bKeys = Object.keys(b as Record<string, unknown>)
  if (aKeys.length !== bKeys.length) return false
  return aKeys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(b, key) &&
      deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])
  )
}

interface Assertion {
  equal(expected: unknown): void
  eql(expected: unknown): void
  include(expected: unknown): void
  property(name: string, value?: unknown): void
  readonly ok: void
  readonly true: void
  readonly false: void
  readonly be: Assertion
  readonly have: Assertion
  above(expected: number): void
  below(expected: number): void
}

interface Expectation {
  to: Assertion & { not: Assertion }
}

function makeAssertion(actual: unknown, negated: boolean): Assertion {
  const check = (passed: boolean, message: string): void => {
    if (passed === negated) {
      throw new Error(negated ? message.replace('expected', 'expected not') : message)
    }
  }

  const assertion: Assertion = {
    equal(expected: unknown) {
      check(actual === expected, `expected ${stringify(actual)} to equal ${stringify(expected)}`)
    },
    eql(expected: unknown) {
      check(
        deepEqual(actual, expected),
        `expected ${stringify(actual)} to deeply equal ${stringify(expected)}`
      )
    },
    above(expected: number) {
      check(
        typeof actual === 'number' && actual > expected,
        `expected ${stringify(actual)} to be above ${stringify(expected)}`
      )
    },
    below(expected: number) {
      check(
        typeof actual === 'number' && actual < expected,
        `expected ${stringify(actual)} to be below ${stringify(expected)}`
      )
    },
    include(expected: unknown) {
      let passed: boolean
      if (typeof actual === 'string') {
        passed = actual.includes(String(expected))
      } else if (Array.isArray(actual)) {
        passed = actual.some((item) => deepEqual(item, expected))
      } else {
        throw new Error(`expected ${stringify(actual)} to be a string or array for include`)
      }
      check(passed, `expected ${stringify(actual)} to include ${stringify(expected)}`)
    },
    property(name: string, ...rest: unknown[]) {
      const isObject = typeof actual === 'object' && actual !== null
      const has = isObject && name in (actual as Record<string, unknown>)
      if (rest.length > 0) {
        const value = rest[0]
        const propValue = has ? (actual as Record<string, unknown>)[name] : undefined
        check(
          has && deepEqual(propValue, value),
          `expected ${stringify(actual)} to have property ${stringify(name)} with value ${stringify(value)}`
        )
      } else {
        check(has, `expected ${stringify(actual)} to have property ${stringify(name)}`)
      }
    },
    get ok() {
      check(Boolean(actual), `expected ${stringify(actual)} to be ok`)
      return undefined
    },
    get true() {
      check(actual === true, `expected ${stringify(actual)} to be true`)
      return undefined
    },
    get false() {
      check(actual === false, `expected ${stringify(actual)} to be false`)
      return undefined
    },
    get be() {
      return assertion
    },
    get have() {
      return assertion
    }
  }
  return assertion
}

function makeExpect(actual: unknown): Expectation {
  const positive = makeAssertion(actual, false)
  const to = positive as Assertion & { not: Assertion }
  Object.defineProperty(to, 'not', {
    get: () => makeAssertion(actual, true)
  })
  return { to }
}

export function runTestScript(
  script: string,
  response: ApiResponse,
  envVars: Record<string, string>
): ScriptOutcome {
  const tests: TestResult[] = []
  const envUpdates: Record<string, string> = {}
  const consoleLines: string[] = []
  const env: Record<string, string> = { ...envVars }

  const headerLookup: Record<string, string> = {}
  for (const [key, value] of Object.entries(response.headers)) {
    headerLookup[key.toLowerCase()] = value
  }

  const pm = {
    response: {
      code: response.status,
      status: response.statusText,
      responseTime: response.timeMs,
      text: () => response.body,
      json: (): unknown => {
        try {
          return JSON.parse(response.body)
        } catch {
          throw new Error(
            `Response body is not valid JSON: ${response.body.slice(0, 100) || '(empty body)'}`
          )
        }
      },
      headers: {
        get: (name: string): string | undefined => headerLookup[name.toLowerCase()]
      }
    },
    environment: {
      get: (key: string): string | undefined => env[key],
      set: (key: string, value: string): void => {
        const stored = String(value)
        env[key] = stored
        envUpdates[key] = stored
      },
      unset: (key: string): void => {
        delete env[key]
        delete envUpdates[key]
      }
    },
    expect: (actual: unknown) => makeExpect(actual),
    test: (name: string, fn: () => void): void => {
      try {
        fn()
        tests.push({ name, passed: true })
      } catch (err) {
        tests.push({
          name,
          passed: false,
          error: err instanceof Error ? err.message : String(err)
        })
      }
    }
  }

  const consoleShim = {
    log: (...args: unknown[]): void => {
      consoleLines.push(
        args
          .map((arg) => {
            if (typeof arg === 'string') return arg
            try {
              const json = JSON.stringify(arg)
              return json === undefined ? String(arg) : json
            } catch {
              return String(arg)
            }
          })
          .join(' ')
      )
    }
  }

  let scriptError: string | undefined
  try {
    const fn = new Function('pm', 'console', script)
    fn(pm, consoleShim)
  } catch (err) {
    scriptError = err instanceof Error ? err.message : String(err)
  }

  return { tests, envUpdates, consoleLines, scriptError }
}

/**
 * Pre-request script runner. Runs before the request is built/sent, so there is
 * no response — `pm.response` throws. Variables set here flow into `{{var}}`
 * substitution for the outgoing request.
 */
export function runPreRequestScript(
  script: string,
  envVars: Record<string, string>
): ScriptOutcome {
  const tests: TestResult[] = []
  const envUpdates: Record<string, string> = {}
  const consoleLines: string[] = []
  const env: Record<string, string> = { ...envVars }

  const noResponse = (): never => {
    throw new Error('pm.response is not available in a pre-request script')
  }

  const pm = {
    get response(): never {
      return noResponse()
    },
    environment: {
      get: (key: string): string | undefined => env[key],
      set: (key: string, value: string): void => {
        const stored = String(value)
        env[key] = stored
        envUpdates[key] = stored
      },
      unset: (key: string): void => {
        delete env[key]
        delete envUpdates[key]
      }
    },
    // alias — Postman exposes both pm.environment and pm.variables
    variables: {
      get: (key: string): string | undefined => env[key],
      set: (key: string, value: string): void => {
        const stored = String(value)
        env[key] = stored
        envUpdates[key] = stored
      }
    },
    expect: (actual: unknown) => makeExpect(actual),
    test: (name: string, fn: () => void): void => {
      try {
        fn()
        tests.push({ name, passed: true })
      } catch (err) {
        tests.push({ name, passed: false, error: err instanceof Error ? err.message : String(err) })
      }
    }
  }

  const consoleShim = {
    log: (...args: unknown[]): void => {
      consoleLines.push(
        args
          .map((arg) => {
            if (typeof arg === 'string') return arg
            try {
              const json = JSON.stringify(arg)
              return json === undefined ? String(arg) : json
            } catch {
              return String(arg)
            }
          })
          .join(' ')
      )
    }
  }

  let scriptError: string | undefined
  try {
    const fn = new Function('pm', 'console', script)
    fn(pm, consoleShim)
  } catch (err) {
    scriptError = err instanceof Error ? err.message : String(err)
  }

  return { tests, envUpdates, consoleLines, scriptError }
}
