import { render, screen, fireEvent, act } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import PrivacyPolicy from './PrivacyPolicy';
import TermsOfService from './TermsOfService';
import Footer from '../components/Footer';
import LegalConsentModal from '../components/LegalConsentModal';
import LegalViewerModal, { openLegalModal } from '../components/LegalViewerModal';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Legal Pages and Components', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders Privacy Policy with key self-hosted privacy sections', () => {
    render(
      <BrowserRouter>
        <PrivacyPolicy />
      </BrowserRouter>
    );

    expect(screen.getByRole('heading', { level: 1, name: /Privacy Policy/i })).toBeInTheDocument();
    expect(screen.getByText(/Self-Hosted & Privacy-First Architecture/i)).toBeInTheDocument();
    expect(screen.getByText(/Data Stored on Your Device/i)).toBeInTheDocument();
    expect(screen.getByText(/Third-Party Metadata Services/i)).toBeInTheDocument();
  });

  it('renders Terms of Service with key licensing sections', () => {
    render(
      <BrowserRouter>
        <TermsOfService />
      </BrowserRouter>
    );

    expect(screen.getByRole('heading', { level: 1, name: /Terms of Service/i })).toBeInTheDocument();
    expect(screen.getByText(/Acceptance of Terms/i)).toBeInTheDocument();
    expect(screen.getByText(/Personal & Private Media Archiving/i)).toBeInTheDocument();
    expect(screen.getByText(/Software Disclaimer & As-Is License/i)).toBeInTheDocument();
  });

  it('renders Footer with Privacy Policy and Terms triggers', () => {
    render(
      <BrowserRouter>
        <Footer />
      </BrowserRouter>
    );

    expect(screen.getByRole('button', { name: /Privacy Policy/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Terms of Service/i })).toBeInTheDocument();
  });

  it('renders LegalViewerModal when triggered by openLegalModal and closes safely', async () => {
    render(
      <BrowserRouter>
        <LegalViewerModal />
      </BrowserRouter>
    );

    // Initially not open
    expect(screen.queryByRole('heading', { name: /Privacy Policy/i })).not.toBeInTheDocument();

    // Trigger open
    act(() => {
      openLegalModal('privacy');
    });

    expect(screen.getByRole('heading', { name: /Privacy Policy/i })).toBeInTheDocument();
    expect(screen.getByText(/1\. Self-Hosted & Privacy-First Architecture/i)).toBeInTheDocument();

    // Switch tabs to Terms
    const termsTab = screen.getByRole('button', { name: /^Terms$/i });
    fireEvent.click(termsTab);
    expect(screen.getByRole('heading', { name: /Terms of Service/i })).toBeInTheDocument();
    expect(screen.getByText(/1\. Acceptance of Terms/i)).toBeInTheDocument();

    // Wait past ghost click cooldown
    await act(async () => {
      await sleep(500);
    });

    // Close viewer
    const closeBtn = screen.getByRole('button', { name: /Close & Return/i });
    fireEvent.click(closeBtn);
    expect(screen.queryByRole('heading', { name: /Terms of Service/i })).not.toBeInTheDocument();
  });

  it('renders LegalConsentModal and allows in-place reading of privacy policy and terms with ghost click protection', async () => {
    render(
      <BrowserRouter>
        <LegalConsentModal />
      </BrowserRouter>
    );

    expect(screen.getByRole('heading', { name: /Welcome to CineVault/i })).toBeInTheDocument();
    
    // Click "Read Full Privacy Policy" to read right there
    const readPrivacyBtn = screen.getByRole('button', { name: /Read Full Privacy Policy/i });
    fireEvent.click(readPrivacyBtn);
    expect(screen.getByText(/1\. Self-Hosted & Privacy-First Architecture/i)).toBeInTheDocument();

    // Wait past ghost-click cooldown
    await act(async () => {
      await sleep(500);
    });

    // Click "Back"
    const backBtn = screen.getByRole('button', { name: /^Back$/i });
    fireEvent.click(backBtn);
    expect(screen.getByRole('heading', { name: /Welcome to CineVault/i })).toBeInTheDocument();

    // Click "Read Full Terms of Service" to read right there
    const readTermsBtn = screen.getByRole('button', { name: /Read Full Terms of Service/i });
    fireEvent.click(readTermsBtn);
    expect(screen.getByText(/1\. Acceptance of Terms/i)).toBeInTheDocument();

    // Wait past ghost-click cooldown
    await act(async () => {
      await sleep(500);
    });

    // Return to agree
    const doneReadingBtn = screen.getByRole('button', { name: /Done Reading • Return to Agree/i });
    fireEvent.click(doneReadingBtn);

    // Accept
    const checkbox = screen.getByRole('checkbox');
    const acceptBtn = screen.getByRole('button', { name: /Accept & Continue/i });

    expect(acceptBtn).toBeDisabled();
    fireEvent.click(checkbox);
    expect(acceptBtn).not.toBeDisabled();

    fireEvent.click(acceptBtn);
    expect(localStorage.getItem('cv_legal_consent_accepted')).toBeTruthy();
  });
});
