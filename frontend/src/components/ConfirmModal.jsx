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
  if (!open) return null

  return createPortal(
    <div className="cm-overlay" onClick={onCancel} role="dialog" aria-modal="true">
      <div className="cm-modal glass animate-fadeUp" onClick={e => e.stopPropagation()}>
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
