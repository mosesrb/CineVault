// Routing context is not authorization. Player still performs its normal
// metadata/session checks and local-file lookup before playback.
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value)

export function getDownloadPlaybackPath(record) {
  if (record?.status !== 'completed' || !record.path || !validId(record.id)) return null
  const id = encodeURIComponent(record.id)
  if (record.type === 'movie') return `/watch/movie/${id}`
  if (record.type === 'episode' && validId(record.metadata?.showId)) {
    return `/watch/tvshow/${encodeURIComponent(record.metadata.showId)}?ep=${id}`
  }
  return null
}

export function getDownloadPlaybackHint(record) {
  if (getDownloadPlaybackPath(record)) return ''
  if (record?.type === 'episode' && !validId(record.metadata?.showId)) {
    return 'Open the original show to play this episode. Its download is preserved.'
  }
  return 'This download is not ready to play.'
}
