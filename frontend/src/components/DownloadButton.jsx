import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Download, CheckCircle2, Loader2, XCircle, AlertCircle } from 'lucide-react';
import { OfflineStorageService } from '../services/OfflineStorageService';
import './DownloadButton.css';

export default function DownloadButton({ mediaId, url, type, metadata, variant = 'default' }) {
  const [status, setStatus] = useState('checking'); // idle, checking, downloading, completed, error
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [error, setError] = useState(null);
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    let unsubscribe = null;

    const init = async () => {
      setStatus('checking');
      try {
        const record = await OfflineStorageService.getDownloadRecord(mediaId);
        
        if (record) {
          if (record.status === 'completed') {
            setStatus('completed');
          } else if (record.status === 'pending') {
            setStatus('downloading');
            setDownloadProgress(record.progress || 0);
            
            // Subscribe to live updates
            unsubscribe = OfflineStorageService.subscribe(mediaId, (pct) => {
              setDownloadProgress(pct);
              if (pct >= 100) setStatus('completed');
            });
          } else {
            setStatus('idle');
          }
        } else {
          setStatus('idle');
        }
      } catch (err) {
        console.error('[DownloadButton] Init failed:', err);
        setStatus('idle');
      }
    };

    init();

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [mediaId]);

  async function handleDownload() {
    if (status === 'completed' || status === 'downloading') return;
    
    if (OfflineStorageService.isDownloading()) {
      setError('Another download is in progress.');
      return;
    }

    setShowConfirm(true);
  }

  async function startDownload() {
    setShowConfirm(false);
    setError(null);
    setStatus('downloading');
    setDownloadProgress(0);

    let unsubscribe = null;
    try {
      const token = localStorage.getItem('cv_token');
      
      unsubscribe = OfflineStorageService.subscribe(mediaId, (pct) => {
        setDownloadProgress(pct);
        if (pct >= 100) {
          setStatus('completed');
        }
      });

      await OfflineStorageService.downloadMedia(
        mediaId, 
        url, 
        type, 
        metadata,
        token
      );
      
      setStatus('completed');
    } catch (err) {
      console.error('Download failed:', err);
      setError(err.message || 'Download failed');
      setStatus('error');
      setTimeout(() => setStatus('idle'), 3000);
    } finally {
      if (unsubscribe) unsubscribe();
    }
  }

  async function removeDownload(e) {
    e.stopPropagation();
    if (!window.confirm('Delete local download?')) return;
    await OfflineStorageService.deleteDownload(mediaId);
    setStatus('idle');
  }

  const isDetail = variant === 'detail';

  if (!url) {
    if (isDetail) {
      return (
        <div className="download-btn-container download-btn--detail">
          <button className="btn btn-ghost" disabled title="No file available for download">
            <Download size={20} style={{opacity:0.3}} />
            <span style={{opacity:0.3}}>No File</span>
          </button>
        </div>
      );
    }
    return null;
  }

  return (
    <div className={`download-btn-container ${isDetail ? 'download-btn--detail' : ''}`}>
      {status === 'idle' && (
        <button className="btn btn-ghost btn-download" onClick={handleDownload} title="Download for offline">
          <Download size={isDetail ? 20 : 16} />
          {isDetail && <span>Download</span>}
        </button>
      )}

      {status === 'checking' && (
        <div className="download-status-loading">
          <Loader2 size={16} className="animate-spin" />
        </div>
      )}

      {status === 'downloading' && (
        <div className="download-status-active">
          <div 
            className="download-progress-bar" 
            style={{ width: `${Math.max(2, downloadProgress)}%` }} 
          />
          <div className="download-active-content">
            <Loader2 size={isDetail ? 20 : 16} className="animate-spin text-accent" />
            {isDetail && (
              <div className="download-text-group">
                <span className="text-accent">Saving {downloadProgress > 0 ? `${downloadProgress}%` : '...'}</span>
                <button 
                  className="btn-cancel-download" 
                  onClick={(e) => {
                    e.stopPropagation();
                    OfflineStorageService.cancelDownload(mediaId);
                  }}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {status === 'completed' && (
        <button className="btn btn-ghost btn-downloaded" onClick={removeDownload} title="Downloaded (Click to remove)">
          <CheckCircle2 size={isDetail ? 20 : 16} className="text-success" />
          {isDetail && <span className="text-success">Offline</span>}
        </button>
      )}

      {status === 'error' && (
        <div className="download-status-error" title={error}>
          <XCircle size={isDetail ? 20 : 16} className="text-danger" />
          {isDetail && <span className="text-danger">Failed</span>}
        </div>
      )}

      {/* Permission/Confirmation Modal */}
      {showConfirm && createPortal(
        <div className="download-confirm-overlay" onClick={() => setShowConfirm(false)}>
          <div className="download-confirm-modal" onClick={e => e.stopPropagation()}>
            <div className="confirm-icon">
              <Download size={32} />
            </div>
            <h3>Download Media?</h3>
            <p>We need your permission to save this file to your device storage for offline viewing. This may take a few minutes depending on your connection.</p>
            <div className="confirm-actions">
              <button className="btn btn-ghost" onClick={() => setShowConfirm(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={startDownload}>Agree & Download</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {error && !showConfirm && (
        <div className="download-error-toast animate-fadeUp">
          <AlertCircle size={14} />
          {error}
        </div>
      )}
    </div>
  );
}
