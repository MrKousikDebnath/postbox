import { describe, expect, it } from 'vitest'
import type { Collection } from '../../../shared/types'
import { exportPostmanCollection, importPostmanCollection } from './postman'

const SCHEMA = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'

function minimalCollection(items: unknown[]): Record<string, unknown> {
  return { info: { name: 'My Collection', schema: SCHEMA }, item: items }
}

describe('importPostmanCollection', () => {
  it('imports a minimal v2.1 collection with one request', () => {
    const col = importPostmanCollection(
      minimalCollection([
        { name: 'Get Users', request: { method: 'GET', url: 'https://api.example.com/users' } }
      ])
    )
    expect(col).not.toBeNull()
    expect(col?.name).toBe('My Collection')
    expect(col?.folders).toEqual([])
    expect(col?.requests).toHaveLength(1)
    expect(col?.requests[0]).toMatchObject({
      name: 'Get Users',
      method: 'GET',
      url: 'https://api.example.com/users',
      bodyType: 'none',
      auth: { type: 'none' }
    })
    expect(col?.requests[0].id).toBeTruthy()
  })

  it('imports a url object with query, splitting query into params', () => {
    const col = importPostmanCollection(
      minimalCollection([
        {
          name: 'Search',
          request: {
            method: 'GET',
            url: {
              raw: 'https://api.example.com/search?q=hotels&limit=10',
              protocol: 'https',
              host: ['api', 'example', 'com'],
              path: ['search'],
              query: [
                { key: 'q', value: 'hotels' },
                { key: 'limit', value: '10', disabled: true }
              ]
            }
          }
        }
      ])
    )
    const req = col?.requests[0]
    expect(req?.url).toBe('https://api.example.com/search')
    expect(req?.params).toEqual([
      { key: 'q', value: 'hotels', enabled: true },
      { key: 'limit', value: '10', enabled: false }
    ])
  })

  it('imports folders and flattens deeper nesting into the same folder', () => {
    const col = importPostmanCollection(
      minimalCollection([
        {
          name: 'Users',
          item: [
            { name: 'List', request: { method: 'GET', url: 'https://x.com/users' } },
            {
              name: 'Admin',
              item: [
                { name: 'Delete', request: { method: 'DELETE', url: 'https://x.com/users/1' } }
              ]
            }
          ]
        }
      ])
    )
    expect(col?.folders).toHaveLength(1)
    expect(col?.folders[0].name).toBe('Users')
    expect(col?.folders[0].requests.map((r) => r.name)).toEqual(['List', 'Delete'])
    expect(col?.requests).toHaveLength(0)
  })

  it('imports urlencoded body as form', () => {
    const col = importPostmanCollection(
      minimalCollection([
        {
          name: 'Login',
          request: {
            method: 'POST',
            url: 'https://x.com/login',
            body: {
              mode: 'urlencoded',
              urlencoded: [
                { key: 'user', value: 'alice' },
                { key: 'debug', value: '1', disabled: true }
              ]
            }
          }
        }
      ])
    )
    const req = col?.requests[0]
    expect(req?.bodyType).toBe('form')
    expect(req?.formBody).toEqual([
      { key: 'user', value: 'alice', enabled: true },
      { key: 'debug', value: '1', enabled: false }
    ])
  })

  it('imports raw json body as json, raw non-json as text', () => {
    const col = importPostmanCollection(
      minimalCollection([
        {
          name: 'Create',
          request: {
            method: 'POST',
            url: 'https://x.com/items',
            body: { mode: 'raw', raw: '{"a":1}', options: { raw: { language: 'json' } } }
          }
        },
        {
          name: 'Note',
          request: {
            method: 'POST',
            url: 'https://x.com/notes',
            body: { mode: 'raw', raw: 'plain text here' }
          }
        }
      ])
    )
    expect(col?.requests[0].bodyType).toBe('json')
    expect(col?.requests[0].body).toBe('{"a":1}')
    expect(col?.requests[1].bodyType).toBe('text')
    expect(col?.requests[1].body).toBe('plain text here')
  })

  it('imports bearer and basic auth (v2.1 param arrays)', () => {
    const col = importPostmanCollection(
      minimalCollection([
        {
          name: 'Bearer',
          request: {
            method: 'GET',
            url: 'https://x.com/a',
            auth: { type: 'bearer', bearer: [{ key: 'token', value: 'tok-123' }] }
          }
        },
        {
          name: 'Basic',
          request: {
            method: 'GET',
            url: 'https://x.com/b',
            auth: {
              type: 'basic',
              basic: [
                { key: 'username', value: 'alice' },
                { key: 'password', value: 's3cret' }
              ]
            }
          }
        },
        {
          name: 'None',
          request: { method: 'GET', url: 'https://x.com/c', auth: { type: 'noauth' } }
        }
      ])
    )
    expect(col?.requests[0].auth).toEqual({ type: 'bearer', token: 'tok-123' })
    expect(col?.requests[1].auth).toEqual({ type: 'basic', username: 'alice', password: 's3cret' })
    expect(col?.requests[2].auth).toEqual({ type: 'none' })
  })

  it('imports apikey auth', () => {
    const col = importPostmanCollection(
      minimalCollection([
        {
          name: 'ApiKey',
          request: {
            method: 'GET',
            url: 'https://x.com/a',
            auth: {
              type: 'apikey',
              apikey: [
                { key: 'key', value: 'X-Api-Key' },
                { key: 'value', value: 'abc123' },
                { key: 'in', value: 'header' }
              ]
            }
          }
        }
      ])
    )
    expect(col?.requests[0].auth).toEqual({
      type: 'apikey',
      headerName: 'X-Api-Key',
      value: 'abc123'
    })
  })

  it('maps disabled headers to enabled:false', () => {
    const col = importPostmanCollection(
      minimalCollection([
        {
          name: 'Headers',
          request: {
            method: 'GET',
            url: 'https://x.com',
            header: [
              { key: 'Accept', value: 'application/json' },
              { key: 'X-Debug', value: '1', disabled: true }
            ]
          }
        }
      ])
    )
    expect(col?.requests[0].headers).toEqual([
      { key: 'Accept', value: 'application/json', enabled: true },
      { key: 'X-Debug', value: '1', enabled: false }
    ])
  })

  it('returns null for unrecognizable input', () => {
    expect(importPostmanCollection(null)).toBeNull()
    expect(importPostmanCollection('not an object')).toBeNull()
    expect(importPostmanCollection({})).toBeNull()
    expect(importPostmanCollection({ info: {}, item: [] })).toBeNull()
    expect(importPostmanCollection({ info: { name: 'x' } })).toBeNull()
    expect(importPostmanCollection({ item: [] })).toBeNull()
  })
})

describe('exportPostmanCollection', () => {
  function sampleCollection(): Collection {
    return {
      id: 'c1',
      name: 'Sample',
      folders: [
        {
          id: 'f1',
          name: 'Auth',
          requests: [
            {
              id: 'r1',
              name: 'Login',
              method: 'POST',
              url: 'https://api.example.com/login',
              params: [],
              headers: [{ key: 'X-Trace', value: 'on', enabled: false }],
              bodyType: 'form',
              body: '',
              formBody: [{ key: 'user', value: 'alice', enabled: true }],
              auth: { type: 'basic', username: 'alice', password: 'pw' }
            }
          ]
        }
      ],
      requests: [
        {
          id: 'r2',
          name: 'Create Item',
          method: 'PUT',
          url: 'https://api.example.com/items',
          params: [
            { key: 'dryRun', value: 'true', enabled: true },
            { key: 'verbose', value: '1', enabled: false }
          ],
          headers: [{ key: 'Accept', value: 'application/json', enabled: true }],
          bodyType: 'json',
          body: '{"name":"widget"}',
          formBody: [],
          auth: { type: 'bearer', token: 'tok' }
        }
      ]
    }
  }

  it('produces the v2.1 schema field and info name', () => {
    const exported = exportPostmanCollection(sampleCollection()) as {
      info: { name: string; schema: string; _postman_id: string }
      item: unknown[]
    }
    expect(exported.info.schema).toBe(SCHEMA)
    expect(exported.info.name).toBe('Sample')
    expect(exported.info._postman_id).toBeTruthy()
    expect(exported.item).toHaveLength(2)
  })

  it('exports url as object with raw, protocol, host, path and query', () => {
    const exported = exportPostmanCollection(sampleCollection()) as {
      item: { name: string; request?: { url: Record<string, unknown> } }[]
    }
    const url = exported.item[1].request?.url
    expect(url).toMatchObject({
      raw: 'https://api.example.com/items?dryRun=true',
      protocol: 'https',
      host: ['api', 'example', 'com'],
      path: ['items'],
      query: [
        { key: 'dryRun', value: 'true' },
        { key: 'verbose', value: '1', disabled: true }
      ]
    })
  })

  it('roundtrip export then import preserves names, methods, urls, params and bodies', () => {
    const original = sampleCollection()
    const reimported = importPostmanCollection(exportPostmanCollection(original))
    expect(reimported).not.toBeNull()
    expect(reimported?.name).toBe(original.name)

    expect(reimported?.folders).toHaveLength(1)
    const folderReq = reimported?.folders[0].requests[0]
    expect(reimported?.folders[0].name).toBe('Auth')
    expect(folderReq).toMatchObject({
      name: 'Login',
      method: 'POST',
      url: 'https://api.example.com/login',
      bodyType: 'form',
      formBody: original.folders[0].requests[0].formBody,
      headers: original.folders[0].requests[0].headers,
      auth: { type: 'basic', username: 'alice', password: 'pw' }
    })

    const topReq = reimported?.requests[0]
    expect(topReq).toMatchObject({
      name: 'Create Item',
      method: 'PUT',
      url: 'https://api.example.com/items',
      params: original.requests[0].params,
      bodyType: 'json',
      body: '{"name":"widget"}',
      auth: { type: 'bearer', token: 'tok' }
    })
  })
})
