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
});
