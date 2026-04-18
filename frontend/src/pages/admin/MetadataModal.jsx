import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Search, Check, Save, Info, Globe } from 'lucide-react';
import { searchTMDB, linkMovieToTMDB, linkTVShowToTMDB, updateMovie, updateTVShow, resolveUrl } from '../../api';
import './MetadataModal.css';

export default function MetadataModal({ item, type, onClose, onSave }) {
    const [activeTab, setActiveTab] = useState('search');
    const [searchQuery, setSearchQuery] = useState(item?.title || '');
    const [results, setResults] = useState([]);
    const [searching, setSearching] = useState(false);
    const [saving, setSaving] = useState(false);

    // Form state for Manual Edit
    const [formData, setFormData] = useState({
        title: item?.title || '',
        year: item?.year || '',
        description: item?.description || '',
        posterUrl: item?.posterUrl || '',
        backdropUrl: item?.backdropUrl || '',
        rating: item?.rating || 0,
        runtime: item?.runtime || 0,
        network: item?.network || '',
        metaSource: item?.metaSource || 'manual'
    });

    useEffect(() => {
        if (activeTab === 'search' && searchQuery && results.length === 0) {
            handleSearch();
        }
    }, [activeTab]);

    async function handleSearch() {
        if (!searchQuery.trim()) return;
        setSearching(true);
        try {
            const res = await searchTMDB(searchQuery, type === 'movie' ? 'movie' : 'tv');
            setResults(res.data || []);
        } catch (err) {
            console.error('TMDB Search failed:', err);
        } finally {
            setSearching(false);
        }
    }

    async function handleLink(tmdbItem) {
        setSaving(true);
        try {
            const linkFn = type === 'movie' ? linkMovieToTMDB : linkTVShowToTMDB;
            const res = await linkFn(item._id, tmdbItem.id);
            onSave(res.data);
            onClose();
        } catch (err) {
            alert('Failed to link metadata: ' + (err.response?.data || err.message));
        } finally {
            setSaving(false);
        }
    }

    async function handleManualSave() {
        setSaving(true);
        try {
            const updateFn = type === 'movie' ? updateMovie : updateTVShow;
            const payload = { 
                ...formData, 
                isConflict: false, 
                conflictOptions: [] 
            };
            const res = await updateFn(item._id, payload);
            onSave(res.data);
            onClose();
        } catch (err) {
            alert('Failed to save manual changes: ' + (err.response?.data || err.message));
        } finally {
            setSaving(false);
        }
    }

    return createPortal(
        <div className="meta-modal-overlay" onClick={onClose}>
            <div className="meta-modal animate-scaleIn" onClick={e => e.stopPropagation()}>
                <div className="meta-modal-header">
                    <div style={{display:'flex', alignItems:'center', gap:'var(--sp-2)'}}>
                        <Info size={18} className="text-accent" />
                        <h3 style={{margin:0, fontSize:'1.1rem'}}>Manage Metadata</h3>
                    </div>
                    <button className="btn btn-ghost btn-sm" onClick={onClose} style={{padding:4}}>
                        <X size={20} />
                    </button>
                </div>

                <div className="meta-modal-tabs">
                    <div 
                        className={`meta-tab ${activeTab === 'search' ? 'active' : ''}`}
                        onClick={() => setActiveTab('search')}
                    >
                        Search TMDB
                    </div>
                    <div 
                        className={`meta-tab ${activeTab === 'manual' ? 'active' : ''}`}
                        onClick={() => setActiveTab('manual')}
                    >
                        Manual Edit
                    </div>
                </div>

                <div className="meta-modal-body">
                    {activeTab === 'search' ? (
                        <div className="search-tab-content">
                            <div className="meta-search-input-row">
                                <input 
                                    className="input"
                                    placeholder="Search movie or TV show title..."
                                    value={searchQuery}
                                    onChange={e => setSearchQuery(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && handleSearch()}
                                />
                                <button className="btn btn-primary" onClick={handleSearch} disabled={searching}>
                                    {searching ? <RefreshCw className="animate-spin" size={18} /> : <Search size={18} />}
                                    <span>Search</span>
                                </button>
                            </div>

                            {searching ? (
                                <div style={{textAlign:'center', padding:'var(--sp-8)'}}>
                                    <RefreshCw className="animate-spin text-accent" size={32} />
                                    <p style={{marginTop:'var(--sp-4)', color:'var(--text-muted)'}}>Consulting the archives...</p>
                                </div>
                            ) : (
                                <div className="meta-results-grid">
                                    {results.map(res => (
                                        <div key={res.id} className="meta-result-card" onClick={() => handleLink(res)}>
                                            <img src={res.posterUrl || '/placeholder.jpg'} alt="" />
                                            <div className="meta-result-info">
                                                <div style={{fontWeight:600, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                                                    {res.title || res.name}
                                                </div>
                                                <div style={{color:'var(--text-muted)'}}>{(res.release_date || res.first_air_date || '').slice(0, 4)}</div>
                                            </div>
                                        </div>
                                    ))}
                                    {results.length === 0 && searchQuery && !searching && (
                                        <div style={{gridColumn:'1 / -1', textAlign:'center', padding:'var(--sp-8)', color:'var(--text-muted)'}}>
                                            No matches found on TMDB.
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="meta-edit-form">
                            <div className="meta-field meta-field-full">
                                <label>Title</label>
                                <input 
                                    className="input"
                                    value={formData.title}
                                    onChange={e => setFormData({...formData, title: e.target.value})}
                                />
                            </div>
                            <div className="meta-field">
                                <label>Year</label>
                                <input 
                                    className="input"
                                    type="number"
                                    value={formData.year}
                                    onChange={e => setFormData({...formData, year: e.target.value})}
                                />
                            </div>
                            <div className="meta-field">
                                <label>Rating (0-10)</label>
                                <input 
                                    className="input"
                                    type="number"
                                    step="0.1"
                                    value={formData.rating}
                                    onChange={e => setFormData({...formData, rating: e.target.value})}
                                />
                            </div>
                            {type === 'tvshow' && (
                                <div className="meta-field meta-field-full">
                                    <label>Network</label>
                                    <input 
                                        className="input"
                                        value={formData.network}
                                        onChange={e => setFormData({...formData, network: e.target.value})}
                                    />
                                </div>
                            )}
                            <div className="meta-field meta-field-full">
                                <label>Description</label>
                                <textarea 
                                    className="input"
                                    rows={4}
                                    value={formData.description}
                                    onChange={e => setFormData({...formData, description: e.target.value})}
                                    style={{padding:'var(--sp-2) var(--sp-3)', resize:'vertical'}}
                                />
                            </div>
                            <div className="meta-field meta-field-full">
                                <label>Poster URL</label>
                                <input 
                                    className="input"
                                    value={formData.posterUrl}
                                    onChange={e => setFormData({...formData, posterUrl: e.target.value})}
                                />
                            </div>
                            <div className="meta-field meta-field-full">
                                <label>Backdrop URL</label>
                                <input 
                                    className="input"
                                    value={formData.backdropUrl}
                                    onChange={e => setFormData({...formData, backdropUrl: e.target.value})}
                                />
                            </div>
                        </div>
                    )}
                </div>

                <div className="meta-modal-footer">
                    <button className="btn btn-ghost" onClick={onClose} disabled={saving}>
                        {activeTab === 'search' ? 'Close' : 'Cancel'}
                    </button>
                    {activeTab === 'manual' && (
                        <button className="btn btn-primary" onClick={handleManualSave} disabled={saving}>
                            {saving ? <RefreshCw className="animate-spin" size={18} /> : <Save size={18} />}
                            <span>Save Changes</span>
                        </button>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
}

// Simple internal helper for the spinner icon since I used it inside buttons
function RefreshCw({ className, size }) {
    return (
        <svg 
            xmlns="http://www.w3.org/2000/svg" 
            width={size} height={size} 
            viewBox="0 0 24 24" fill="none" 
            stroke="currentColor" strokeWidth="2" 
            strokeLinecap="round" strokeLinejoin="round" 
            className={className}
        >
            <path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>
        </svg>
    )
}
