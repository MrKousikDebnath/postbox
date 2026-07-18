import { describe, expect, it } from 'vitest'
import type { ApiResponse } from '../../../shared/types'
import { runTestScript } from './scripts'

function makeResponse(overrides: Partial<ApiResponse> = {}): ApiResponse {
  return {
    status: 200,
    statusText: 'OK',
    headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'abc-123' },
    body: '{"id": 1, "name": "widget", "tags": ["a", "b"]}',
    bodyTruncated: false,
    timeMs: 42,
    sizeBytes: 47,
    ...overrides
  }
}

describe('runTestScript', () => {
  it('records a passing status code test', () => {
    const outcome = runTestScript(
      `pm.test('status is 200', function () { pm.expect(pm.response.code).to.equal(200) })`,
      makeResponse(),
      {}
    )
    expect(outcome.tests).toEqual([{ name: 'status is 200', passed: true }])
    expect(outcome.scriptError).toBeUndefined()
  })

  it('records a failing assertion with a readable error message', () => {
    const outcome = runTestScript(
      `pm.test('status is 404', function () { pm.expect(pm.response.code).to.equal(404) })`,
      makeResponse(),
      {}
    )
    expect(outcome.tests).toHaveLength(1)
    expect(outcome.tests[0].passed).toBe(false)
    expect(outcome.tests[0].error).toBe('expected 200 to equal 404')
  })

  it('parses the response body via pm.response.json()', () => {
    const outcome = runTestScript(
      `pm.test('body has name', function () {
        const data = pm.response.json()
        pm.expect(data.name).to.equal('widget')
      })`,
      makeResponse(),
      {}
    )
    expect(outcome.tests[0].passed).toBe(true)
  })

  it('gives a readable failure when pm.response.json() gets invalid JSON', () => {
    const outcome = runTestScript(
      `pm.test('parse body', function () { pm.response.json() })`,
      makeResponse({ body: 'not json at all' }),
      {}
    )
    expect(outcome.tests[0].passed).toBe(false)
    expect(outcome.tests[0].error).toContain('not valid JSON')
    expect(outcome.scriptError).toBeUndefined()
  })

  it('supports environment get/set/unset and reports envUpdates', () => {
    const outcome = runTestScript(
      `pm.test('env roundtrip', function () {
        pm.expect(pm.environment.get('base')).to.equal('https://api.example.com')
        pm.environment.set('token', 'xyz')
        pm.expect(pm.environment.get('token')).to.equal('xyz')
        pm.environment.unset('base')
        pm.expect(pm.environment.get('base')).to.not.be.ok
      })`,
      makeResponse(),
      { base: 'https://api.example.com' }
    )
    expect(outcome.tests[0].passed).toBe(true)
    expect(outcome.envUpdates).toEqual({ token: 'xyz' })
  })

  it('records multiple pm.test calls in order', () => {
    const outcome = runTestScript(
      `pm.test('first', function () { pm.expect(1).to.equal(1) })
       pm.test('second', function () { pm.expect(2).to.equal(3) })
       pm.test('third', function () { pm.expect(true).to.be.true })`,
      makeResponse(),
      {}
    )
    expect(outcome.tests.map((t) => t.name)).toEqual(['first', 'second', 'third'])
    expect(outcome.tests.map((t) => t.passed)).toEqual([true, false, true])
  })

  it('supports deep equality via to.eql', () => {
    const outcome = runTestScript(
      `pm.test('deep equal', function () {
        pm.expect(pm.response.json()).to.eql({ id: 1, name: 'widget', tags: ['a', 'b'] })
      })
      pm.test('deep unequal', function () {
        pm.expect({ a: 1 }).to.eql({ a: 2 })
      })`,
      makeResponse(),
      {}
    )
    expect(outcome.tests[0].passed).toBe(true)
    expect(outcome.tests[1].passed).toBe(false)
    expect(outcome.tests[1].error).toContain('deeply equal')
  })

  it('supports include on strings and arrays', () => {
    const outcome = runTestScript(
      `pm.test('string include', function () {
        pm.expect(pm.response.text()).to.include('widget')
      })
      pm.test('array include', function () {
        pm.expect(pm.response.json().tags).to.include('b')
      })
      pm.test('array include missing', function () {
        pm.expect(pm.response.json().tags).to.include('z')
      })`,
      makeResponse(),
      {}
    )
    expect(outcome.tests.map((t) => t.passed)).toEqual([true, true, false])
  })

  it('supports have.property with and without a value', () => {
    const outcome = runTestScript(
      `pm.test('has property', function () {
        pm.expect(pm.response.json()).to.have.property('name')
      })
      pm.test('has property with value', function () {
        pm.expect(pm.response.json()).to.have.property('name', 'widget')
      })
      pm.test('wrong property value', function () {
        pm.expect(pm.response.json()).to.have.property('name', 'gadget')
      })`,
      makeResponse(),
      {}
    )
    expect(outcome.tests.map((t) => t.passed)).toEqual([true, true, false])
    expect(outcome.tests[2].error).toContain('gadget')
  })

  it('supports negation via to.not', () => {
    const outcome = runTestScript(
      `pm.test('not equal passes', function () {
        pm.expect(pm.response.code).to.not.equal(500)
      })
      pm.test('not equal fails', function () {
        pm.expect(pm.response.code).to.not.equal(200)
      })
      pm.test('comparisons', function () {
        pm.expect(pm.response.responseTime).to.be.above(10)
        pm.expect(pm.response.responseTime).to.be.below(1000)
      })`,
      makeResponse(),
      {}
    )
    expect(outcome.tests.map((t) => t.passed)).toEqual([true, false, true])
    expect(outcome.tests[1].error).toContain('not')
  })

  it('captures console.log lines, stringifying objects', () => {
    const outcome = runTestScript(
      `console.log('hello', 'world')
       console.log({ a: 1 }, [1, 2])`,
      makeResponse(),
      {}
    )
    expect(outcome.consoleLines).toEqual(['hello world', '{"a":1} [1,2]'])
  })

  it('reports a syntax error as scriptError and keeps prior tests on runtime throw', () => {
    const syntaxOutcome = runTestScript(`this is not valid javascript (((`, makeResponse(), {})
    expect(syntaxOutcome.scriptError).toBeTruthy()
    expect(syntaxOutcome.tests).toEqual([])

    const runtimeOutcome = runTestScript(
      `pm.test('recorded first', function () { pm.expect(1).to.equal(1) })
       throw new Error('boom')`,
      makeResponse(),
      {}
    )
    expect(runtimeOutcome.scriptError).toBe('boom')
    expect(runtimeOutcome.tests).toEqual([{ name: 'recorded first', passed: true }])
  })

  it('resolves headers case-insensitively via pm.response.headers.get', () => {
    const outcome = runTestScript(
      `pm.test('header lookup', function () {
        pm.expect(pm.response.headers.get('content-type')).to.equal('application/json')
        pm.expect(pm.response.headers.get('X-REQUEST-ID')).to.equal('abc-123')
        pm.expect(pm.response.headers.get('missing')).to.not.be.ok
      })`,
      makeResponse(),
      {}
    )
    expect(outcome.tests[0].passed).toBe(true)
  })
})
