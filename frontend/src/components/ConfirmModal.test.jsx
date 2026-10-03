import { useState } from 'react'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { afterEach, describe, it, expect, vi } from 'vitest'
import ConfirmModal from './ConfirmModal'

afterEach(cleanup)
function Harness({ onConfirm = () => {} }) {
  const [open, setOpen] = useState(false)
  const [revision, setRevision] = useState(0)
  return <>
    <button onClick={() => setOpen(true)}>Open</button>
    <ConfirmModal open={open} title="Synthetic confirmation" onConfirm={onConfirm} onCancel={() => setOpen(false)}>
      <button disabled>Disabled</button>
      <button hidden>Hidden</button>
      <button onClick={() => setRevision(revision + 1)}>Extra {revision}</button>
    </ConfirmModal>
  </>
}
function open() {
  const opener = screen.getByRole('button', { name: 'Open' })
  opener.focus()
  fireEvent.click(opener)
  return opener
}
describe('confirmation remote focus', () => {
  it('starts on safe Cancel, cycles arrows over enabled visible buttons, and never confirms on arrows', () => {
    const confirm = vi.fn()
    render(<Harness onConfirm={confirm} />)
    open()
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    expect(cancel).toHaveFocus()
    fireEvent.keyDown(cancel, { key: 'ArrowRight' })
    expect(screen.getByRole('button', { name: 'Confirm' })).toHaveFocus()
    fireEvent.keyDown(document.activeElement, { key: 'ArrowDown' })
    expect(screen.getByRole('button', { name: 'Extra 0' })).toHaveFocus()
    fireEvent.keyDown(document.activeElement, { key: 'ArrowLeft' })
    expect(screen.getByRole('button', { name: 'Confirm' })).toHaveFocus()
    expect(confirm).not.toHaveBeenCalled()
  })
  it('traps Tab/Shift-Tab and prevents background focus', () => {
    render(<Harness />)
    const opener = open()
    const first = screen.getByRole('button', { name: 'Extra 0' })
    const last = screen.getByRole('button', { name: 'Confirm' })
    last.focus()
    fireEvent.keyDown(last, { key: 'Tab' })
    expect(first).toHaveFocus()
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })
    expect(last).toHaveFocus()
    opener.focus()
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
  })
  it('does not reset focus on rerender with a new close callback', () => {
    render(<Harness />)
    open()
    const extra = screen.getByRole('button', { name: 'Extra 0' })
    extra.focus()
    fireEvent.click(extra)
    expect(screen.getByRole('button', { name: 'Extra 1' })).toHaveFocus()
  })
  it.each(['Escape', 'Back', 'Cancel'])('closes using %s and restores opener', mode => {
    render(<Harness />)
    const opener = open()
    if (mode === 'Escape') fireEvent.keyDown(window, { key: 'Escape' })
    else if (mode === 'Back') {
      const event = new CustomEvent('cv_hardware_back', { cancelable: true })
      fireEvent(window, event)
      expect(event.defaultPrevented).toBe(true)
    } else fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })
})
