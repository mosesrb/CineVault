import { afterEach, describe, expect, it, vi } from 'vitest'
import { openDB } from 'idb'
import { OfflineCacheService } from './OfflineCacheService'

vi.mock('../api', () => ({ default: { post: vi.fn() } }))
afterEach(() => vi.restoreAllMocks())
describe('unchanged offline metadata validity', () => {
  it('returns valid cached metadata without extending its timestamp', async () => {
    const url = '/synthetic/cache-valid'
    const now = 100000000
    vi.spyOn(Date, 'now').mockReturnValue(now)
    await OfflineCacheService.setCache(url, { title: 'Synthetic title' })
    vi.spyOn(Date, 'now').mockReturnValue(now + 23 * 60 * 60 * 1000)
    expect(await OfflineCacheService.getCache(url)).toEqual({ title: 'Synthetic title' })
    const db = await openDB('cinevault-offline', 2)
    expect((await db.get('api_cache', url)).timestamp).toBe(now)
    await db.delete('api_cache', url)
    db.close()
  })
  it('rejects and removes metadata after 24 hours', async () => {
    const url = '/synthetic/cache-expired'
    const now = 100000000
    vi.spyOn(Date, 'now').mockReturnValue(now)
    await OfflineCacheService.setCache(url, { title: 'Must expire' })
    vi.spyOn(Date, 'now').mockReturnValue(now + 24 * 60 * 60 * 1000 + 1)
    expect(await OfflineCacheService.getCache(url)).toBeNull()
    const db = await openDB('cinevault-offline', 2)
    expect(await db.get('api_cache', url)).toBeUndefined()
    db.close()
  })
})
