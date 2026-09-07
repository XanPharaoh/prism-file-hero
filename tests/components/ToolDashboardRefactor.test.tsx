import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ToolDashboard from '../../src/components/views/ToolDashboard';

describe('ToolDashboard Revamp', () => {
  it('renders Smallpdf-style headline and Popular Tools grid', () => {
    render(<ToolDashboard onSelectTool={vi.fn()} />);

    expect(screen.getByText(/We make document work simple/i)).toBeDefined();
    expect(
      screen.getByText(/All the tools you need to convert, compress, merge, and sign PDFs right in your browser/i)
    ).toBeDefined();
    expect(screen.getByRole('button', { name: /Try it Free/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /Explore All 37 Tools/i })).toBeDefined();
    expect(screen.getByText(/Most Popular Document Tools/i)).toBeDefined();
  });

  it('does NOT render fake CA(SA) testimonials or fake dashboard cards', () => {
    render(<ToolDashboard onSelectTool={vi.fn()} />);
    expect(screen.queryByText(/Rohan Govender, CA\(SA\)/i)).toBeNull();
    expect(screen.queryByText(/Danielle van der Merwe/i)).toBeNull();
    expect(screen.queryByText(/Statement_October_Chase\.pdf/i)).toBeNull();
    expect(screen.queryByText(/Statement_September_WellsFargo\.xlsx/i)).toBeNull();
    expect(screen.queryByText(/500\+ banks recognised/i)).toBeNull();
    expect(screen.queryByText(/0 row errors in 18 months/i)).toBeNull();
  });

  it('does not render the removed FeatureShowcase section', () => {
    render(<ToolDashboard onSelectTool={vi.fn()} />);
    expect(screen.queryByText(/Assemble and organize in seconds/i)).toBeNull();
    expect(screen.queryByText(/Bank statements that actually balance/i)).toBeNull();
    expect(screen.queryByText(/Everything you need to work with PDFs/i)).toBeNull();
  });

  it('mounts PricingPreview with upgrade and free options', () => {
    render(<ToolDashboard onSelectTool={vi.fn()} />);
    expect(screen.getByText(/Simple, Fair Pricing/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /Upgrade to Pro/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /Start Free/i })).toBeDefined();
  });

  it('toggles full catalog when clicking "See All 37 PDF Tools" or "Explore All 37 Tools"', () => {
    render(<ToolDashboard onSelectTool={vi.fn()} />);
    
    // Initially catalog is collapsed
    expect(screen.queryByLabelText('Search tools')).toBeNull();

    // Click explore button in Hero or toggle in PopularToolsGrid
    const toggleBtn = screen.getByRole('button', { name: /See All 37 PDF Tools/i });
    fireEvent.click(toggleBtn);

    // Catalog search input is now visible
    expect(screen.getByLabelText('Search tools')).toBeDefined();
  });
});
