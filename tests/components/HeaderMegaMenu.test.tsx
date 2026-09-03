import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import HeaderMegaMenu from '../../src/components/navigation/HeaderMegaMenu';

describe('HeaderMegaMenu', () => {
  it('renders Tools trigger and Pricing link', () => {
    const onSelectTool = vi.fn();
    const onNavigatePricing = vi.fn();
    render(<HeaderMegaMenu onSelectTool={onSelectTool} onNavigatePricing={onNavigatePricing} />);

    expect(screen.getByText(/Tools/i)).toBeDefined();
    expect(screen.getByText(/Pricing/i)).toBeDefined();
  });

  it('opens mega dropdown when Tools button is clicked', () => {
    const onSelectTool = vi.fn();
    const onNavigatePricing = vi.fn();
    render(<HeaderMegaMenu onSelectTool={onSelectTool} onNavigatePricing={onNavigatePricing} />);

    const toolsBtn = screen.getByRole('button', { name: /tools/i });
    fireEvent.click(toolsBtn);

    expect(screen.getByText('Organize')).toBeDefined();
    expect(screen.getByText('Convert')).toBeDefined();
    expect(screen.getByText('Optimize & Secure')).toBeDefined();
  });

  it('calls onSelectTool and closes dropdown when a tool is clicked', () => {
    const onSelectTool = vi.fn();
    const onNavigatePricing = vi.fn();
    render(<HeaderMegaMenu onSelectTool={onSelectTool} onNavigatePricing={onNavigatePricing} />);

    fireEvent.click(screen.getByRole('button', { name: /tools/i }));
    const mergeBtn = screen.getByText('Merge PDF');
    fireEvent.click(mergeBtn);

    expect(onSelectTool).toHaveBeenCalledWith('merge');
    expect(screen.queryByText('Organize')).toBeNull();
  });

  it('navigates to pricing when Pricing button is clicked', () => {
    const onSelectTool = vi.fn();
    const onNavigatePricing = vi.fn();
    render(<HeaderMegaMenu onSelectTool={onSelectTool} onNavigatePricing={onNavigatePricing} />);

    const pricingBtn = screen.getByRole('button', { name: /pricing/i });
    fireEvent.click(pricingBtn);

    expect(onNavigatePricing).toHaveBeenCalledTimes(1);
  });

  it('navigates to bank statement when Bank Statements button is clicked', () => {
    const onSelectTool = vi.fn();
    const onNavigatePricing = vi.fn();
    const onNavigateBankStatement = vi.fn();
    render(
      <HeaderMegaMenu
        onSelectTool={onSelectTool}
        onNavigatePricing={onNavigatePricing}
        onNavigateBankStatement={onNavigateBankStatement}
      />
    );

    const bankBtn = screen.getByRole('button', { name: /bank statements/i });
    fireEvent.click(bankBtn);

    expect(onNavigateBankStatement).toHaveBeenCalledTimes(1);
  });

  it('falls back to onSelectTool("pdf-to-excel") if onNavigateBankStatement is not provided', () => {
    const onSelectTool = vi.fn();
    const onNavigatePricing = vi.fn();
    render(<HeaderMegaMenu onSelectTool={onSelectTool} onNavigatePricing={onNavigatePricing} />);

    const bankBtn = screen.getByRole('button', { name: /bank statements/i });
    fireEvent.click(bankBtn);

    expect(onSelectTool).toHaveBeenCalledWith('pdf-to-excel');
  });

  it('closes dropdown when clicking outside', () => {
    const onSelectTool = vi.fn();
    const onNavigatePricing = vi.fn();
    render(
      <div>
        <div data-testid="outside">Outside</div>
        <HeaderMegaMenu onSelectTool={onSelectTool} onNavigatePricing={onNavigatePricing} />
      </div>
    );

    fireEvent.click(screen.getByRole('button', { name: /tools/i }));
    expect(screen.getByText('Organize')).toBeDefined();

    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.queryByText('Organize')).toBeNull();
  });
});
