import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import FeatureShowcase from '../../src/components/home/FeatureShowcase';
import PricingPreview from '../../src/components/home/PricingPreview';

describe('FeatureShowcase', () => {
  it('renders all three showcase headlines', () => {
    render(<FeatureShowcase onSelectTool={vi.fn()} />);
    expect(screen.getByText(/Assemble and organize in seconds/i)).toBeDefined();
    expect(screen.getByText(/Bank statements that actually balance/i)).toBeDefined();
    expect(screen.getByText(/Fast, private, and in-browser/i)).toBeDefined();
  });

  it('triggers onSelectTool with "merge" when clicking "Merge a PDF now"', () => {
    const onSelect = vi.fn();
    render(<FeatureShowcase onSelectTool={onSelect} />);

    const mergeBtn = screen.getByRole('button', { name: /Merge a PDF now/i });
    fireEvent.click(mergeBtn);
    expect(onSelect).toHaveBeenCalledWith('merge');
  });

  it('triggers onSelectTool with "pdf-to-excel" when clicking "Try statement converter"', () => {
    const onSelect = vi.fn();
    render(<FeatureShowcase onSelectTool={onSelect} />);

    const convertBtn = screen.getByRole('button', { name: /Try statement converter/i });
    fireEvent.click(convertBtn);
    expect(onSelect).toHaveBeenCalledWith('pdf-to-excel');
  });
});

describe('PricingPreview', () => {
  it('renders Free Tier and Professional plans with pricing details', () => {
    render(<PricingPreview onUpgrade={vi.fn()} onSelectFree={vi.fn()} />);

    expect(screen.getByText('Simple, Fair Pricing')).toBeDefined();
    expect(screen.getByText('Free Tier')).toBeDefined();
    expect(screen.getByText('Professional')).toBeDefined();
    expect(screen.getByText('R 0')).toBeDefined();
    expect(screen.getByText('R 239')).toBeDefined();
    expect(screen.getByText(/3 free tasks per day/i)).toBeDefined();
    expect(screen.getByText(/Unlimited bank statement conversions/i)).toBeDefined();
  });

  it('triggers onSelectFree when clicking Start Free', () => {
    const onSelectFree = vi.fn();
    render(<PricingPreview onUpgrade={vi.fn()} onSelectFree={onSelectFree} />);

    const freeBtn = screen.getByRole('button', { name: /Start Free/i });
    fireEvent.click(freeBtn);
    expect(onSelectFree).toHaveBeenCalledTimes(1);
  });

  it('triggers onUpgrade when clicking Upgrade to Pro', () => {
    const onUpgrade = vi.fn();
    render(<PricingPreview onUpgrade={onUpgrade} onSelectFree={vi.fn()} />);

    const proBtn = screen.getByRole('button', { name: /Upgrade to Pro/i });
    fireEvent.click(proBtn);
    expect(onUpgrade).toHaveBeenCalledTimes(1);
  });
});
