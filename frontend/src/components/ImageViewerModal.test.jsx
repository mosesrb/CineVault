import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import ImageViewerModal from './ImageViewerModal'

describe('ImageViewerModal', () => {
  const mockImages = [
    '/uploads/image1.jpg',
    '/uploads/image2.jpg',
    '/uploads/image3.jpg'
  ]

  it('renders image, title, and counter when open', () => {
    render(
      <ImageViewerModal
        isOpen={true}
        images={mockImages}
        initialIndex={0}
        title="Interstellar"
        onClose={vi.fn()}
      />
    )

    expect(screen.getByText('Interstellar')).toBeInTheDocument()
    expect(screen.getByText('1 / 3')).toBeInTheDocument()
    const mainImg = screen.getByAltText('Interstellar - 1')
    expect(mainImg).toBeInTheDocument()
  })

  it('navigates with next and previous buttons', () => {
    render(
      <ImageViewerModal
        isOpen={true}
        images={mockImages}
        initialIndex={0}
        title="Interstellar"
        onClose={vi.fn()}
      />
    )

    const nextBtn = screen.getByLabelText('Next image')
    fireEvent.click(nextBtn)
    expect(screen.getByText('2 / 3')).toBeInTheDocument()

    const prevBtn = screen.getByLabelText('Previous image')
    fireEvent.click(prevBtn)
    expect(screen.getByText('1 / 3')).toBeInTheDocument()
  })

  it('supports keyboard navigation with arrow keys and escape', () => {
    const handleClose = vi.fn()
    render(
      <ImageViewerModal
        isOpen={true}
        images={mockImages}
        initialIndex={0}
        title="Interstellar"
        onClose={handleClose}
      />
    )

    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(screen.getByText('2 / 3')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(screen.getByText('1 / 3')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(handleClose).toHaveBeenCalled()
  })

  it('intercepts Android hardware back button to close modal', () => {
    const handleClose = vi.fn()
    render(
      <ImageViewerModal
        isOpen={true}
        images={mockImages}
        initialIndex={0}
        title="Interstellar"
        onClose={handleClose}
      />
    )

    const event = new CustomEvent('cv_hardware_back', { cancelable: true })
    window.dispatchEvent(event)

    expect(handleClose).toHaveBeenCalled()
  })

  it('switches image when clicking on thumbnail', () => {
    render(
      <ImageViewerModal
        isOpen={true}
        images={mockImages}
        initialIndex={0}
        title="Interstellar"
        onClose={vi.fn()}
      />
    )

    const thirdThumb = screen.getByLabelText('Go to image 3')
    fireEvent.click(thirdThumb)
    expect(screen.getByText('3 / 3')).toBeInTheDocument()
  })
})
