import { useId } from 'react'
import { Link } from 'react-router-dom'
import { getDownloadPlaybackPath, getDownloadPlaybackHint } from '../utils/downloadPlayback'

export default function DownloadPlayLink({ record, children, className, onClick }) {
  const descriptionId = useId()
  const route = getDownloadPlaybackPath(record)
  const label = `Play downloaded ${record.metadata?.title || 'item'}`
  if (route) return <Link to={route} className={className} onClick={onClick} aria-label={label}>{children}</Link>
  return <>
    <button type="button" disabled className={className} aria-label={label} aria-describedby={descriptionId}>{children}</button>
    <span id={descriptionId} hidden>{getDownloadPlaybackHint(record)}</span>
  </>
}
