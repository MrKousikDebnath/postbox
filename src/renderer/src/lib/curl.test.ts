import { describe, it, expect } from 'vitest'
import { parseCurl, toCurl, toFetch, toAxios } from './curl'
import type { ApiRequest } from '../../../shared/types'

function baseRequest(overrides: Partial<ApiRequest> = {}): ApiRequest {
  return {
    id: 'test-id',
    name: 'Test',
    method: 'GET',
    url: 'https://api.example.com/users',
    params: [],
    headers: [],
    bodyType: 'none',
    body: '',
    formBody: [],
    auth: { type: 'none' },
    ...overrides
  }
}

describe('parseCurl', () => {
  it('parses a simple GET with a bare URL', () => {
    const result = parseCurl('curl https://api.example.com/users')
    expect(result).not.toBeNull()
    expect(result!.method).toBe('GET')
    expect(result!.url).toBe('https://api.example.com/users')
    expect(result!.bodyType).toBe('none')
    expect(result!.name).toBe('GET api.example.com')
  })

  it('parses POST with -d JSON body and defaults method to POST', () => {
    const result = parseCurl(`curl https://api.example.com/users -d '{"name":"kousik","age":30}'`)
    expect(result!.method).toBe('POST')
    expect(result!.bodyType).toBe('json')
    expect(result!.body).toBe('{"name":"kousik","age":30}')
  })

  it('parses multiple -H headers', () => {
    const result = parseCurl(
      `curl https://api.example.com -H 'Content-Type: application/json' -H 'X-Trace-Id: abc123'`
    )
    expect(result!.headers).toEqual([
      { key: 'Content-Type', value: 'application/json', enabled: true },
      { key: 'X-Trace-Id', value: 'abc123', enabled: true }
    ])
  })

  it('handles quoted values containing spaces', () => {
    const result = parseCurl(
      `curl https://api.example.com -H "User-Agent: My Custom Agent 1.0" -d 'plain text with spaces'`
    )
    expect(result!.headers[0]).toEqual({
      key: 'User-Agent',
      value: 'My Custom Agent 1.0',
      enabled: true
    })
    expect(result!.body).toBe('plain text with spaces')
    expect(result!.bodyType).toBe('text')
  })

  it('maps -u to basic auth', () => {
    const result = parseCurl('curl -u alice:s3cret https://api.example.com')
    expect(result!.auth).toEqual({ type: 'basic', username: 'alice', password: 's3cret' })
  })

  it('extracts Authorization: Bearer header into auth and excludes it from headers', () => {
    const result = parseCurl(
      `curl https://api.example.com -H 'Authorization: Bearer my-token-123' -H 'Accept: application/json'`
    )
    expect(result!.auth).toEqual({ type: 'bearer', token: 'my-token-123' })
    expect(result!.headers).toEqual([{ key: 'Accept', value: 'application/json', enabled: true }])
  })

  it('honors -X PUT', () => {
    const result = parseCurl(`curl -X PUT https://api.example.com/users/1 -d '{"name":"bob"}'`)
    expect(result!.method).toBe('PUT')
    expect(result!.name).toBe('PUT api.example.com')
  })

  it('splits the query string into params and strips it from the url', () => {
    const result = parseCurl('curl "https://api.example.com/search?q=hello%20world&limit=10"')
    expect(result!.url).toBe('https://api.example.com/search')
    expect(result!.params).toEqual([
      { key: 'q', value: 'hello world', enabled: true },
      { key: 'limit', value: '10', enabled: true }
    ])
  })

  it('handles backslash-newline line continuations', () => {
    const command = `curl -X POST 'https://api.example.com/users' \\
  -H 'Content-Type: application/json' \\
  -d '{"a":1}'`
    const result = parseCurl(command)
    expect(result!.method).toBe('POST')
    expect(result!.url).toBe('https://api.example.com/users')
    expect(result!.headers).toHaveLength(1)
    expect(result!.bodyType).toBe('json')
  })

  it("parses $'...' quoted strings", () => {
    const result = parseCurl(`curl https://api.example.com -d $'line1\\nline2'`)
    expect(result!.body).toBe('line1\nline2')
    expect(result!.bodyType).toBe('text')
  })

  it('maps -F form fields to formBody with bodyType form', () => {
    const result = parseCurl(
      'curl https://api.example.com/upload -F name=kousik -F "title=senior engineer"'
    )
    expect(result!.bodyType).toBe('form')
    expect(result!.formBody).toEqual([
      { key: 'name', value: 'kousik', enabled: true },
      { key: 'title', value: 'senior engineer', enabled: true }
    ])
  })

  it('supports --request and --url flags', () => {
    const result = parseCurl('curl --request DELETE --url https://api.example.com/users/9')
    expect(result!.method).toBe('DELETE')
    expect(result!.url).toBe('https://api.example.com/users/9')
  })

  it('returns null on garbage input with no URL', () => {
    expect(parseCurl('this is definitely not a curl command')).toBeNull()
    expect(parseCurl('')).toBeNull()
    expect(parseCurl('curl -X POST')).toBeNull()
  })
})

describe('toCurl', () => {
  it('generates a multi-line curl command with headers, auth and body', () => {
    const req = baseRequest({
      method: 'POST',
      headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
      bodyType: 'json',
      body: '{"a":1}',
      auth: { type: 'bearer', token: 'tok123' }
    })
    const curl = toCurl(req)
    expect(curl).toContain("curl -X POST 'https://api.example.com/users'")
    expect(curl).toContain(" \\\n  -H 'Content-Type: application/json'")
    expect(curl).toContain("-H 'Authorization: Bearer tok123'")
    expect(curl).toContain(`-d '{"a":1}'`)
  })

  it('appends only enabled params and emits --data-urlencode for form bodies', () => {
    const req = baseRequest({
      params: [
        { key: 'q', value: 'hello world', enabled: true },
        { key: 'skip', value: 'me', enabled: false }
      ],
      bodyType: 'form',
      formBody: [{ key: 'name', value: 'kousik', enabled: true }],
      auth: { type: 'basic', username: 'alice', password: 's3cret' }
    })
    const curl = toCurl(req)
    expect(curl).toContain("'https://api.example.com/users?q=hello%20world'")
    expect(curl).not.toContain('skip')
    expect(curl).toContain("-u 'alice:s3cret'")
    expect(curl).toContain("--data-urlencode 'name=kousik'")
  })

  it('roundtrips through parseCurl preserving method, url and headers', () => {
    const req = baseRequest({
      method: 'PATCH',
      url: 'https://api.example.com/v2/items',
      headers: [
        { key: 'Content-Type', value: 'application/json', enabled: true },
        { key: 'X-Custom', value: 'some value with spaces', enabled: true }
      ],
      bodyType: 'json',
      body: '{"status":"active"}'
    })
    const parsed = parseCurl(toCurl(req))
    expect(parsed).not.toBeNull()
    expect(parsed!.method).toBe(req.method)
    expect(parsed!.url).toBe(req.url)
    expect(parsed!.headers).toEqual(req.headers)
    expect(parsed!.body).toBe(req.body)
    expect(parsed!.bodyType).toBe('json')
  })
})

describe('toFetch', () => {
  it('generates a fetch snippet with method, headers and body', () => {
    const req = baseRequest({
      method: 'POST',
      headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
      bodyType: 'json',
      body: '{"a":1}',
      auth: { type: 'apikey', headerName: 'X-Api-Key', value: 'key123' }
    })
    const snippet = toFetch(req)
    expect(snippet).toContain("await fetch('https://api.example.com/users'")
    expect(snippet).toContain("method: 'POST'")
    expect(snippet).toContain("'Content-Type': 'application/json'")
    expect(snippet).toContain("'X-Api-Key': 'key123'")
    expect(snippet).toContain(`body: '{"a":1}'`)
  })
})

describe('toAxios', () => {
  it('generates an axios snippet with lowercase method, url, auth and data', () => {
    const req = baseRequest({
      method: 'POST',
      params: [{ key: 'page', value: '2', enabled: true }],
      bodyType: 'text',
      body: 'hello',
      auth: { type: 'basic', username: 'alice', password: 's3cret' }
    })
    const snippet = toAxios(req)
    expect(snippet).toContain('await axios({')
    expect(snippet).toContain("method: 'post'")
    expect(snippet).toContain("url: 'https://api.example.com/users?page=2'")
    expect(snippet).toContain("auth: { username: 'alice', password: 's3cret' }")
    expect(snippet).toContain("data: 'hello'")
  })
})
