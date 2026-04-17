import { useState } from 'react'
import { SlidersHorizontal, X } from 'lucide-react'
import './FilterDrawer.css'

export default function FilterDrawer({ genres = [], filters, onChange }) {
  const [open, setOpen] = useState(false)

  const activeCount = [
    filters.minRating > 0,
    filters.maxDuration > 0,
    filters.minYear > 0,
    filters.maxYear > 0,
    filters.watched !== '',
    filters.genre !== '',
  ].filter(Boolean).length

  function reset() {
    onChange({ minRating: 0, maxDuration: 0, minYear: 0, maxYear: 0, watched: '', genre: '' })
  }

  return (
    <>
      {/* Trigger Button */}
      <button
        className={`filter-trigger btn btn-ghost btn-sm ${activeCount > 0 ? 'filter-trigger--active' : ''}`}
        onClick={() => setOpen(true)}
        aria-label="Open filters"
      >
        <SlidersHorizontal size={16} />
        Filters
        {activeCount > 0 && <span className="filter-badge">{activeCount}</span>}
      </button>

      {/* Backdrop */}
      {open && <div className="filter-backdrop" onClick={() => setOpen(false)} />}

      {/* Drawer panel */}
      <div className={`filter-drawer ${open ? 'filter-drawer--open' : ''}`}>
        <div className="filter-drawer-header">
          <h2 className="filter-drawer-title">Filters</h2>
          {activeCount > 0 && (
            <button className="filter-clear btn btn-sm btn-ghost" onClick={reset}>Reset all</button>
          )}
          <button className="filter-close" onClick={() => setOpen(false)} aria-label="Close filters">
            <X size={20} />
          </button>
        </div>

        <div className="filter-drawer-body">
          {/* Genre */}
          <div className="filter-group">
            <label className="filter-label">Genre</label>
            <div className="filter-chips">
              <button
                className={`filter-chip ${filters.genre === '' ? 'filter-chip--active' : ''}`}
                onClick={() => onChange({ ...filters, genre: '' })}
              >All</button>
              {genres.map(g => (
                <button
                  key={g._id}
                  className={`filter-chip ${filters.genre === g.slug ? 'filter-chip--active' : ''}`}
                  onClick={() => onChange({ ...filters, genre: filters.genre === g.slug ? '' : g.slug })}
                >{g.name}</button>
              ))}
            </div>
          </div>

          {/* Minimum Rating */}
          <div className="filter-group">
            <label className="filter-label">
              Minimum Rating
              <span className="filter-value">{filters.minRating > 0 ? `★ ${filters.minRating}+` : 'Any'}</span>
            </label>
            <div className="filter-rating-chips">
              {[0, 6, 7, 7.5, 8, 9].map(r => (
                <button
                  key={r}
                  className={`filter-chip ${filters.minRating === r ? 'filter-chip--active' : ''}`}
                  onClick={() => onChange({ ...filters, minRating: filters.minRating === r ? 0 : r })}
                >{r === 0 ? 'Any' : `★ ${r}+`}</button>
              ))}
            </div>
          </div>

          {/* Duration */}
          <div className="filter-group">
            <label className="filter-label">Max Duration</label>
            <div className="filter-chips">
              {[
                { label: 'Any', value: 0 },
                { label: '< 90 min', value: 5400 },
                { label: '< 2 hrs', value: 7200 },
                { label: '< 3 hrs', value: 10800 },
              ].map(d => (
                <button
                  key={d.value}
                  className={`filter-chip ${filters.maxDuration === d.value ? 'filter-chip--active' : ''}`}
                  onClick={() => onChange({ ...filters, maxDuration: filters.maxDuration === d.value ? 0 : d.value })}
                >{d.label}</button>
              ))}
            </div>
          </div>

          {/* Year */}
          <div className="filter-group">
            <label className="filter-label">Release Year</label>
            <div className="filter-year-row">
              <input
                type="number"
                className="input filter-year-input"
                placeholder="From"
                min="1888" max="2100"
                value={filters.minYear || ''}
                onChange={e => onChange({ ...filters, minYear: parseInt(e.target.value) || 0 })}
              />
              <span className="filter-year-dash">–</span>
              <input
                type="number"
                className="input filter-year-input"
                placeholder="To"
                min="1888" max="2100"
                value={filters.maxYear || ''}
                onChange={e => onChange({ ...filters, maxYear: parseInt(e.target.value) || 0 })}
              />
            </div>
          </div>

          {/* Watched status */}
          <div className="filter-group">
            <label className="filter-label">Watch Status</label>
            <div className="filter-chips">
              {[
                { label: 'All', value: '' },
                { label: 'Unwatched', value: 'unwatched' },
                { label: 'Watched', value: 'watched' },
              ].map(s => (
                <button
                  key={s.value}
                  className={`filter-chip ${filters.watched === s.value ? 'filter-chip--active' : ''}`}
                  onClick={() => onChange({ ...filters, watched: filters.watched === s.value ? '' : s.value })}
                >{s.label}</button>
              ))}
            </div>
          </div>
        </div>

        <div className="filter-drawer-footer">
          <button className="btn btn-primary" style={{ width: '100%' }} onClick={() => setOpen(false)}>
            Show Results
          </button>
        </div>
      </div>
    </>
  )
}
