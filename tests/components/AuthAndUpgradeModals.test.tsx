import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAppStore } from '../../src/store/appStore';
import UpgradeModal from '../../src/components/UpgradeModal';
import AccountPanel from '../../src/components/AccountPanel';
import AuthModal from '../../src/components/AuthModal';

// Mock Clerk hooks
vi.mock('@clerk/react', () => ({
  useAuth: () => ({ isSignedIn: false }),
  useClerk: () => ({
    signOut: vi.fn(),
  }),
  SignIn: () => <div data-testid="clerk-sign-in">Clerk Sign In Mock</div>,
  SignUp: () => <div data-testid="clerk-sign-up">Clerk Sign Up Mock</div>,
}));

describe('UpgradeModal', () => {
  beforeEach(() => {
    act(() => {
      useAppStore.setState({
        user: null,
        isPremium: false,
        showUpgradeCTA: true,
      });
    });
  });

  it('renders all three subscription tiers with pricing and features', () => {
    const onClose = vi.fn();
    render(<UpgradeModal onClose={onClose} />);

    expect(screen.getByText(/Prism File Hero Subscription Plans/i)).toBeInTheDocument();
    expect(screen.getByText(/Starter \/ Free/i)).toBeInTheDocument();
    expect(screen.getByText(/Professional/i)).toBeInTheDocument();
    expect(screen.getByText(/Business \/ Firm/i)).toBeInTheDocument();
    expect(screen.getByText(/Subscribe to Pro/i)).toBeInTheDocument();
    expect(screen.getByText(/Subscribe to Business/i)).toBeInTheDocument();
  });

  it('switches between ZAR and USD currency displays', () => {
    render(<UpgradeModal onClose={vi.fn()} />);

    // Default currency is ZAR
    expect(screen.getByText(/R299/i)).toBeInTheDocument();

    // Click USD
    fireEvent.click(screen.getByRole('button', { name: /USD \(\$\)/i }));
    expect(screen.getByText(/\$19/i)).toBeInTheDocument();
  });

  it('prompts authentication when an unauthenticated user attempts to subscribe', () => {
    const onClose = vi.fn();
    render(<UpgradeModal onClose={onClose} />);

    const proBtn = screen.getByText(/Subscribe to Pro/i);
    fireEvent.click(proBtn);

    // Should prompt sign up and close modal
    expect(onClose).toHaveBeenCalled();
    const state = useAppStore.getState();
    expect(state.showAuthModal).toBe(true);
    expect(state.authModalMode).toBe('sign-up');
  });
});

describe('AccountPanel', () => {
  it('renders user details, free status, and upgrade trigger', () => {
    const onSignOut = vi.fn();
    act(() => {
      useAppStore.setState({
        user: { id: 'u_1', email: 'accountant@test.co.za', name: 'John Doe' },
        isPremium: false,
      });
    });

    render(
      <AccountPanel
        user={{ id: 'u_1', email: 'accountant@test.co.za', name: 'John Doe' }}
        onSignOut={onSignOut}
      />
    );

    expect(screen.getByText('John Doe')).toBeInTheDocument();
    expect(screen.getByText('accountant@test.co.za')).toBeInTheDocument();
    expect(screen.getByText('FREE')).toBeInTheDocument();
    expect(screen.getByText(/Upgrade/i)).toBeInTheDocument();

    // Click Upgrade
    fireEvent.click(screen.getByText(/Upgrade/i));
    expect(useAppStore.getState().showUpgradeCTA).toBe(true);
  });
});

describe('AuthModal', () => {
  it('renders tab switcher for Sign In and Create Account and toggles between them', () => {
    const onClose = vi.fn();
    render(<AuthModal onClose={onClose} initialMode="sign-in" />);

    expect(screen.getByText(/Prism File Hero Account/i)).toBeInTheDocument();
    expect(screen.getByTestId('clerk-sign-in')).toBeInTheDocument();

    // Click Create Account tab
    const createAccountTab = screen.getByRole('button', { name: /Create Account/i });
    fireEvent.click(createAccountTab);

    expect(screen.getByTestId('clerk-sign-up')).toBeInTheDocument();
  });
});

