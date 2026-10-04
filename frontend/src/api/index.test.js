import axios from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import api, { getMovie, getTVShow, getEpisodes, getSeasonEpisodes, getMe, scanLibrary, getStreamTicket } from './index'
import { OfflineCacheService } from '../services/OfflineCacheService'

vi.mock('../services/OfflineCacheService', () => ({ OfflineCacheService: {
  setCache: vi.fn().mockResolvedValue(), getCache: vi.fn(), queueSync: vi.fn(),
} }))
const originalAdapter = api.defaults.adapter
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); OfflineCacheService.getCache.mockResolvedValue(null) })
afterEach(() => { api.defaults.adapter = originalAdapter; vi.useRealTimers(); vi.restoreAllMocks(); localStorage.clear() })

describe('bounded bootstrap and playback metadata reads', () => {
  it.each([
    ['movie', () => getMovie('synthetic'), '/movies/synthetic'],
    ['show', () => getTVShow('synthetic'), '/tvshows/synthetic'],
    ['episodes', () => getEpisodes('synthetic', { season: 2 }), '/tvshows/synthetic/episodes'],
    ['season episodes', () => getSeasonEpisodes('synthetic', 2), '/tvshows/synthetic/seasons/2/episodes'],
    ['session bootstrap', () => getMe(), '/users/me'],
  ])('sets a finite timeout for %s without changing the request path or auth headers', async (_, read, path) => {
    let request
    localStorage.setItem('cv_token', 'synthetic-session')
    api.defaults.adapter = async config => { request = config; return { data: {}, status: 200, config } }
    await read()
    expect(request.timeout).toBe(10000)
    expect(request.url).toBe(path)
    if (path === '/tvshows/synthetic/episodes') expect(request.params).toEqual({ season: 2 })
    expect(request.headers['x-auth-token']).toBe('synthetic-session')
    expect(request.headers.Authorization).toBe('Bearer synthetic-session')
  })

  it('reaches existing cache fallback when a metadata response never arrives', async () => {
    vi.useFakeTimers()
    const cached = { _id: 'synthetic', title: 'Synthetic cached movie' }
    OfflineCacheService.getCache.mockResolvedValue(cached)
    api.defaults.adapter = config => new Promise((_, reject) => {
      if (config.timeout > 0) setTimeout(() => reject(new axios.AxiosError('Synthetic timeout', 'ECONNABORTED', config)), config.timeout)
    })
    const request = getMovie('synthetic')
    await vi.advanceTimersByTimeAsync(10000)
    expect(OfflineCacheService.getCache).toHaveBeenCalledWith('/api/v1/movies/synthetic')
    const response = await request
    expect(response.isCached).toBe(true)
    expect(response.data).toEqual(cached)
  })

  it('rejects a timeout when no valid cache is available', async () => {
    api.defaults.adapter = config => Promise.reject(new axios.AxiosError('Synthetic timeout', 'ECONNABORTED', config))
    await expect(getMovie('synthetic')).rejects.toMatchObject({ code: 'ECONNABORTED' })
  })

  it.each([401, 403, 404])('never substitutes cached metadata for HTTP%s', async status => {
    localStorage.setItem('cv_token', 'synthetic-session')
    localStorage.setItem('cv_user', 'synthetic-user')
    OfflineCacheService.getCache.mockResolvedValue({ title: 'Must not be returned' })
    api.defaults.adapter = config => Promise.reject(new axios.AxiosError('Synthetic refusal', 'ERR_BAD_REQUEST', config, {}, { status, config }))
    await expect(getMovie('synthetic')).rejects.toMatchObject({ response: { status } })
    expect(OfflineCacheService.getCache).not.toHaveBeenCalled()
    expect(localStorage.getItem('cv_token')).toBe(status === 401 ? null : 'synthetic-session')
    expect(localStorage.getItem('cv_user')).toBe(status === 401 ? null : 'synthetic-user')
  })

  it('does not impose the metadata timeout on mutation jobs or streaming tickets', async () => {
    const requests = []
    api.defaults.adapter = async config => { requests.push(config); return { data: {}, status: 200, config } }
    await scanLibrary(); await getStreamTicket('Inbox/synthetic.mp4')
    expect(requests.map(r => r.timeout)).toEqual([0, 0])
    expect(requests.map(r => r.method)).toEqual(['post', 'post'])
  })
})
