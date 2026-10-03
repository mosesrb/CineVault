import { useState } from 'react'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { afterEach, describe, it, expect, vi } from 'vitest'
import ImageViewerModal from './ImageViewerModal'
vi.mock('../api', () => ({ resolveUrl: value => value }))
afterEach(cleanup)

// Preserve the original viewer rendering/button/thumbnail/navigation regressions.
describe('ImageViewerModal', () => {
  const mockImages = ['/uploads/image1.jpg', '/uploads/image2.jpg', '/uploads/image3.jpg']
  it('renders image, title, and counter when open', () => {
    render(<ImageViewerModal isOpen={true} images={mockImages} initialIndex={0} title="Interstellar" onClose={vi.fn()} />)
    expect(screen.getByText('Interstellar')).toBeInTheDocument()
    expect(screen.getByText('1 / 3')).toBeInTheDocument()
    expect(screen.getByAltText('Interstellar - 1')).toBeInTheDocument()
  })
  it('navigates with next and previous buttons', () => {
    render(<ImageViewerModal isOpen={true} images={mockImages} initialIndex={0} title="Interstellar" onClose={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('Next image'))
    expect(screen.getByText('2 / 3')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Previous image'))
    expect(screen.getByText('1 / 3')).toBeInTheDocument()
  })
  it('supports keyboard navigation with arrow keys and escape', () => {
    const handleClose = vi.fn()
    render(<ImageViewerModal isOpen={true} images={mockImages} initialIndex={0} title="Interstellar" onClose={handleClose} />)
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(screen.getByText('2 / 3')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(screen.getByText('1 / 3')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(handleClose).toHaveBeenCalled()
  })
  it('intercepts Android hardware back button to close modal', () => {
    const handleClose = vi.fn()
    render(<ImageViewerModal isOpen={true} images={mockImages} initialIndex={0} title="Interstellar" onClose={handleClose} />)
    const event = new CustomEvent('cv_hardware_back', { cancelable: true })
    window.dispatchEvent(event)
    expect(handleClose).toHaveBeenCalled()
  })
  it('switches image when clicking on thumbnail', () => {
    render(<ImageViewerModal isOpen={true} images={mockImages} initialIndex={0} title="Interstellar" onClose={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('Go to image 3'))
    expect(screen.getByText('3 / 3')).toBeInTheDocument()
  })
})

function Harness() {
  const [open, setOpen] = useState(false)
  return <><button onClick={() => setOpen(true)}>Pictures</button>
    <ImageViewerModal isOpen={open} images={['/qa-one.png', '/qa-two.png']} title="Synthetic" onClose={() => setOpen(false)} />
  </>
}
describe('picture viewer remote focus', () => {
  it('focuses Close while preserving arrow image navigation and Tab containment', () => {
    render(<Harness />)
    const opener = screen.getByRole('button', { name: 'Pictures' })
    opener.focus()
    fireEvent.click(opener)
    const close = screen.getByRole('button', { name: 'Close picture viewer' })
    expect(close).toHaveFocus()
    fireEvent.keyDown(close, { key: 'ArrowRight' })
    expect(screen.getByAltText('Synthetic - 2')).toHaveAttribute('src', '/qa-two.png')
    expect(close).toHaveFocus()
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })
    expect(screen.getByRole('button', { name: 'Go to image 2' })).toHaveFocus()
  })
  it.each(['Escape', 'Back'])('closes with %s without leaving its opener', mode => {
    render(<Harness />)
    const opener = screen.getByRole('button', { name: 'Pictures' })
    opener.focus()
    fireEvent.click(opener)
    if (mode === 'Escape') fireEvent.keyDown(window, { key: 'Escape' })
    else fireEvent(window, new CustomEvent('cv_hardware_back', { cancelable: true }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })
})
