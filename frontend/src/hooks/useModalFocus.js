import { useEffect, useRef } from 'react'

function isFocusable(element, container) {
  if (element.disabled || element.tabIndex < 0 || element.closest('[hidden], [inert], [aria-hidden="true"]')) return false
  for (let item = element; item; item = item.parentElement) {
    const style = getComputedStyle(item)
    if (style.display === 'none' || style.visibility === 'hidden') return false
    if (item === container) break
  }
  return true
}

/** Contain dialog focus, handle native Back, and restore its opener on close. */
export default function useModalFocus({ open, containerRef, initialFocusRef, onClose, arrows = true }) {
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (!open) return
    const opener = document.activeElement
    const container = containerRef.current
    if (!container) return
    const focusables = () => Array.from(container.querySelectorAll(
      'button, [href], input, select, textarea, iframe, [tabindex]:not([tabindex="-1"])'
    )).filter(element => isFocusable(element, container))
    const focusFirst = () => (initialFocusRef?.current || focusables()[0] || container).focus()
    focusFirst()
    const handleBack = event => {
      event.preventDefault()
      closeRef.current?.()
    }
    const handleKey = event => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        closeRef.current?.()
        return
      }
      const items = focusables()
      if (!items.length) return
      const active = document.activeElement
      const index = items.indexOf(active)
      if (event.key === 'Tab') {
        if (index < 0 || (event.shiftKey && index === 0) || (!event.shiftKey && index === items.length - 1)) {
          event.preventDefault()
          const target = event.shiftKey ? items.at(-1) : items[0]
          target.focus()
        }
      } else if (arrows && !['INPUT', 'SELECT', 'TEXTAREA', 'IFRAME'].includes(active?.tagName) &&
        ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
        event.preventDefault()
        // A cross-origin frame cannot forward its keys to the host dialog.
        // Keep D-pad navigation on host controls; Tab/pointer still enter the frame.
        const arrowItems = items.filter(item => item.tagName !== 'IFRAME')
        if (!arrowItems.length) return
        const arrowIndex = arrowItems.indexOf(active)
        const direction = ['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 1
        arrowItems[(arrowIndex + direction + arrowItems.length) % arrowItems.length].focus()
      }
    }
    const containFocus = event => { if (!container.contains(event.target)) focusFirst() }
    window.addEventListener('cv_hardware_back', handleBack)
    window.addEventListener('keydown', handleKey, true)
    document.addEventListener('focusin', containFocus)
    return () => {
      window.removeEventListener('cv_hardware_back', handleBack)
      window.removeEventListener('keydown', handleKey, true)
      document.removeEventListener('focusin', containFocus)
      if (opener?.isConnected && typeof opener.focus === 'function') opener.focus()
    }
  }, [open, containerRef, initialFocusRef, arrows])
}
