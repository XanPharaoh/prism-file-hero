import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import PopularToolsGrid from '../../src/components/home/PopularToolsGrid';

describe('PopularToolsGrid', () => {
  it('renders all 6 top tools with descriptions', () => {
    const onSelect = vi.fn();
    render(<PopularToolsGrid onSelectTool={onSelect} onToggleAllTools={vi.fn()} isAllToolsOpen={false} />);

    expect(screen.getByText('PDF to Word')).toBeDefined();
    expect(screen.getByText('Merge PDF')).toBeDefined();
    expect(screen.getByText('Compress PDF')).toBeDefined();
    expect(screen.getByText('Sign & Redact')).toBeDefined();
    expect(screen.getByText('PDF to Excel')).toBeDefined();
    expect(screen.getByText('Bank Statement to Excel')).toBeDefined();
  });

  it('triggers tool selection on card click', () => {
    const onSelect = vi.fn();
    render(<PopularToolsGrid onSelectTool={onSelect} onToggleAllTools={vi.fn()} isAllToolsOpen={false} />);

    fireEvent.click(screen.getByText('Merge PDF'));
    expect(onSelect).toHaveBeenCalledWith('merge');
  });

  it('triggers onToggleAllTools on directory button click', () => {
    const onToggle = vi.fn();
    render(<PopularToolsGrid onSelectTool={vi.fn()} onToggleAllTools={onToggle} isAllToolsOpen={false} />);

    const btn = screen.getByRole('button', { name: /See All 37 PDF Tools/i });
    fireEvent.click(btn);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('renders "Hide Full Directory" when isAllToolsOpen is true', () => {
    render(<PopularToolsGrid onSelectTool={vi.fn()} onToggleAllTools={vi.fn()} isAllToolsOpen={true} />);

    expect(screen.getByText('Hide Full Directory')).toBeDefined();
  });

  it('renders Pro badge for Bank Statement to Excel', () => {
    render(<PopularToolsGrid onSelectTool={vi.fn()} onToggleAllTools={vi.fn()} isAllToolsOpen={false} />);

    expect(screen.getByText('Pro')).toBeDefined();
  });
});
