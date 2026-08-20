import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import './ConfirmModal.css'

/**
 * Reusable styled confirmation modal.
 *
 * Props:
 *   open       {boolean}  - Whether the modal is visible
 *   title      {string}   - Modal heading
 *   message    {string}   - Body text / description
 *   confirmLabel {string} - Label for the confirm button (default: "Confirm")
 *   cancelLabel  {string} - Label for the cancel button (default: "Cancel")
 *   danger     {boolean}  - If true, confirm button is styled in danger red
 *   onConfirm  {function} - Called when user clicks confirm
 *   onCancel   {function} - Called when user clicks cancel or backdrop
 */
export default function ConfirmModal({
  open, title, message,
  confirmLabel = 'Confirm', cancelLabel = 'Cancel',
  danger = false,
  onConfirm, onCancel,
  children
}) {
  const modalRef = useRef(null)

  useEffect(() => {
    if (!open) return

    const handleBack = (e) => {
      e.preventDefault?.()
      onCancel?.()
    }

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCancel?.()
        return
      }

      // Simple focus trapping inside modal
      if (e.key === 'Tab' && modalRef.current) {
        const focusables = modalRef.current.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
        if (focusables.length > 0) {
          const first = focusables[0]
          const last = focusables[focusables.length - 1]
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault()
            last.focus()
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault()
            first.focus()
          }
        }
      }
    }

    window.addEventListener('cv_hardware_back', handleBack)
    window.addEventListener('keydown', handleKeyDown)

    // Focus the first button on mount
    const timer = setTimeout(() => {
      if (modalRef.current) {
        const firstBtn = modalRef.current.querySelector('button')
        firstBtn?.focus()
      }
    }, 50)

    return () => {
      clearTimeout(timer)
      window.removeEventListener('cv_hardware_back', handleBack)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, onCancel])

  if (!open) return null

  return createPortal(
    <div className="cm-overlay" onClick={onCancel} role="dialog" aria-modal="true">
      <div ref={modalRef} className="cm-modal glass animate-fadeUp" onClick={e => e.stopPropagation()}>
        {title && <h3 className="cm-title">{title}</h3>}
        {message && <p className="cm-message">{message}</p>}
        {children}
        <div className="cm-actions">
          <button className="btn btn-ghost" onClick={onCancel}>{cancelLabel}</button>
          <button
            className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
