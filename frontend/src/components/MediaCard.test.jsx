import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import MediaCard from './MediaCard';

describe('MediaCard', () => {
  const mockItem = {
    _id: '123',
    title: 'Test Movie',
    year: 2026,
    mediaType: 'movie',
    rating: 8.5
  };

  it('renders movie title and year', () => {
    render(
      <BrowserRouter>
        <MediaCard item={mockItem} />
      </BrowserRouter>
    );
    
    // Check if the title is rendered
    expect(screen.getByText('Test Movie')).toBeInTheDocument();
    
    // Check if the year is rendered
    expect(screen.getByText('2026')).toBeInTheDocument();
  });

  it('renders TV badge for tvshows', () => {
    const tvItem = { ...mockItem, mediaType: 'tvshow' };
    render(
      <BrowserRouter>
        <MediaCard item={tvItem} />
      </BrowserRouter>
    );
    
    expect(screen.getByText('TV')).toBeInTheDocument();
  });

  it('correctly resolves item._type when type="mixed" is passed', () => {
    const tvItem = { _id: 'tv99', title: 'Mixed TV', _type: 'tvshow' };
    const { container } = render(
      <BrowserRouter>
        <MediaCard item={tvItem} type="mixed" />
      </BrowserRouter>
    );
    const link = container.querySelector('a[href="/detail/tvshow/tv99"]');
    expect(link).toBeInTheDocument();
  });

  it('normalizes type="tv" to "tvshow" in detail link', () => {
    const tvItem = { _id: 'tv88', title: 'Short TV', type: 'tv' };
    const { container } = render(
      <BrowserRouter>
        <MediaCard item={tvItem} />
      </BrowserRouter>
    );
    const link = container.querySelector('a[href="/detail/tvshow/tv88"]');
    expect(link).toBeInTheDocument();
  });
});
