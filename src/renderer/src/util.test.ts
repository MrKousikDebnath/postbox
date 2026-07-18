import { describe, expect, it } from 'vitest'
import type { ApiRequest, Environment, RecordedRequest } from '../../shared/types'
import {
  buildExecutable,
  emptyRequest,
  formatBytes,
  recordedToApiRequest,
  statusClass,
  substituteVariables,
  tryPrettyJson
} from './util'

function env(vars: Record<string, string>): Environment {
  return {
    id: 'e1',
    name: 'test',
    variables: Object.entries(vars).map(([key, value]) => ({ key, value, enabled: true }))
  }
}

function req(overrides: Partial<ApiRequest>): ApiRequest {
  return { ...emptyRequest(), ...overrides }
}

describe('substituteVariables', () => {
  it('replaces known variables', () => {
    expect(substituteVariables('{{host}}/api', env({ host: 'https://x.com' }))).toBe(
      'https://x.com/api'
    )
  })

  it('leaves unknown variables untouched', () => {
    expect(substituteVariables('{{missing}}/api', env({}))).toBe('{{missing}}/api')
  })

  it('ignores disabled variables', () => {
    const e = env({ host: 'https://x.com' })
    e.variables[0].enabled = false
    expect(substituteVariables('{{host}}', e)).toBe('{{host}}')
  })

  it('returns text unchanged with no environment', () => {
    expect(substituteVariables('{{host}}', null)).toBe('{{host}}')
  })
})

describe('buildExecutable', () => {
  it('appends enabled query params, skips disabled and empty keys', () => {
    const r = req({
      url: 'https://api.test/items',
      params: [
        { key: 'a', value: '1', enabled: true },
        { key: 'b', value: '2', enabled: false },
        { key: '', value: 'x', enabled: true }
      ]
    })
    expect(buildExecutable(r, null).url).toBe('https://api.test/items?a=1')
  })

  it('appends with & when URL already has a query string', () => {
    const r = req({
      url: 'https://api.test/items?x=0',
      params: [{ key: 'a', value: '1', enabled: true }]
    })
    expect(buildExecutable(r, null).url).toBe('https://api.test/items?x=0&a=1')
  })

  it('URL-encodes param keys and values', () => {
    const r = req({
      url: 'https://api.test',
      params: [{ key: 'q', value: 'a b&c', enabled: true }]
    })
    expect(buildExecutable(r, null).url).toBe('https://api.test?q=a%20b%26c')
  })

  it('substitutes variables in url, headers and body', () => {
    const r = req({
      url: '{{host}}/users',
      method: 'POST',
      headers: [{ key: 'X-Env', value: '{{name}}', enabled: true }],
      bodyType: 'json',
      body: '{"env":"{{name}}"}'
    })
    const e = env({ host: 'https://x.com', name: 'prod' })
    const exec = buildExecutable(r, e)
    expect(exec.url).toBe('https://x.com/users')
    expect(exec.headers['X-Env']).toBe('prod')
    expect(exec.body).toBe('{"env":"prod"}')
  })

  it('sets bearer auth header', () => {
    const r = req({ url: 'https://x.com', auth: { type: 'bearer', token: 'tok123' } })
    expect(buildExecutable(r, null).headers['Authorization']).toBe('Bearer tok123')
  })

  it('sets basic auth header with base64 credentials', () => {
    const r = req({
      url: 'https://x.com',
      auth: { type: 'basic', username: 'user', password: 'pass' }
    })
    expect(buildExecutable(r, null).headers['Authorization']).toBe(`Basic ${btoa('user:pass')}`)
  })

  it('sets api key header with custom name', () => {
    const r = req({
      url: 'https://x.com',
      auth: { type: 'apikey', headerName: 'X-API-Key', value: 'secret' }
    })
    expect(buildExecutable(r, null).headers['X-API-Key']).toBe('secret')
  })

  it('defaults Content-Type for json body without overriding an explicit one', () => {
    const r = req({ url: 'https://x.com', method: 'POST', bodyType: 'json', body: '{}' })
    expect(buildExecutable(r, null).headers['Content-Type']).toBe('application/json')

    const withExplicit = req({
      url: 'https://x.com',
      method: 'POST',
      bodyType: 'json',
      body: '{}',
      headers: [{ key: 'content-type', value: 'application/vnd.custom+json', enabled: true }]
    })
    const headers = buildExecutable(withExplicit, null).headers
    expect(headers['Content-Type']).toBeUndefined()
    expect(headers['content-type']).toBe('application/vnd.custom+json')
  })

  it('encodes form body and sets urlencoded Content-Type', () => {
    const r = req({
      url: 'https://x.com',
      method: 'POST',
      bodyType: 'form',
      formBody: [
        { key: 'a', value: '1 2', enabled: true },
        { key: 'skip', value: 'x', enabled: false }
      ]
    })
    const exec = buildExecutable(r, null)
    expect(exec.body).toBe('a=1%202')
    expect(exec.headers['Content-Type']).toBe('application/x-www-form-urlencoded')
  })

  it('omits body for bodyType none', () => {
    const r = req({ url: 'https://x.com', method: 'POST', bodyType: 'none' })
    expect(buildExecutable(r, null).body).toBeUndefined()
  })
})

describe('recordedToApiRequest', () => {
  const recorded: RecordedRequest = {
    requestId: '1',
    url: 'https://api.test/v1/search?q=hotels&page=2',
    method: 'POST',
    resourceType: 'XHR',
    requestHeaders: {
      ':authority': 'api.test',
      'content-length': '42',
      Host: 'api.test',
      Authorization: 'Bearer abc',
      'Content-Type': 'application/json'
    },
    requestBody: '{"query":"hotels"}',
    startTime: 0,
    finished: true
  }

  it('splits URL into base and params', () => {
    const r = recordedToApiRequest(recorded)
    expect(r.url).toBe('https://api.test/v1/search')
    expect(r.params).toEqual([
      { key: 'q', value: 'hotels', enabled: true },
      { key: 'page', value: '2', enabled: true }
    ])
  })

  it('drops pseudo-headers and hop-by-hop headers, keeps real ones', () => {
    const r = recordedToApiRequest(recorded)
    const keys = r.headers.map((h) => h.key)
    expect(keys).not.toContain(':authority')
    expect(keys).not.toContain('content-length')
    expect(keys).not.toContain('Host')
    expect(keys).toContain('Authorization')
  })

  it('detects JSON bodies', () => {
    const r = recordedToApiRequest(recorded)
    expect(r.bodyType).toBe('json')
    expect(r.body).toBe('{"query":"hotels"}')
  })

  it('handles requests without a body', () => {
    const r = recordedToApiRequest({ ...recorded, requestBody: undefined, method: 'GET' })
    expect(r.bodyType).toBe('none')
    expect(r.method).toBe('GET')
  })
})

describe('formatBytes', () => {
  it('formats byte ranges', () => {
    expect(formatBytes(undefined)).toBe('—')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.00 MB')
  })
})

describe('tryPrettyJson', () => {
  it('pretty-prints valid JSON and passes through invalid text', () => {
    expect(tryPrettyJson('{"a":1}')).toBe('{\n  "a": 1\n}')
    expect(tryPrettyJson('<html>')).toBe('<html>')
  })
})

describe('statusClass', () => {
  it('maps status ranges to css classes', () => {
    expect(statusClass(undefined)).toBe('status-err')
    expect(statusClass(0)).toBe('status-err')
    expect(statusClass(200)).toBe('status-2xx')
    expect(statusClass(301)).toBe('status-3xx')
    expect(statusClass(404)).toBe('status-4xx')
    expect(statusClass(503)).toBe('status-5xx')
  })
})
