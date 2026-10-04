import { describe, it, expect } from 'vitest'
import { getDownloadPlaybackPath, getDownloadPlaybackHint } from './downloadPlayback'

const ready = { id: 'qa-episode', status: 'completed', path: 'synthetic-local-file', type: 'episode', metadata: { showId: 'qa-show' } }
describe('download playback routing', () => {
  it('routes a completed movie by its own id', () => {
    expect(getDownloadPlaybackPath({ ...ready, type: 'movie' })).toBe('/watch/movie/qa-episode')
  })
  it('routes a completed episode by parent show and episode query', () => {
    expect(getDownloadPlaybackPath(ready)).toBe('/watch/tvshow/qa-show?ep=qa-episode')
  })
  it.each([
    undefined, { ...ready, metadata: {} }, { ...ready, metadata: { showId: '../private' } },
    { ...ready, id: 'x?ep=other' }, { ...ready, type: 'tvshow' }, { ...ready, status: 'pending' },
    { ...ready, path: null },
  ])('never invents an unsafe or incomplete route for %j', record => {
    const before = JSON.stringify(record)
    expect(getDownloadPlaybackPath(record)).toBeNull()
    expect(getDownloadPlaybackHint(record)).not.toBe('')
    expect(JSON.stringify(record)).toBe(before)
  })
  it('explains how to use a preserved legacy episode', () => {
    expect(getDownloadPlaybackHint({ ...ready, metadata: {} })).toContain('Open the original show')
    expect(getDownloadPlaybackHint(ready)).toBe('')
  })
})
