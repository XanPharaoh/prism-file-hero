import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import ToolDashboard from '../../src/components/views/ToolDashboard';

/**
 * The uploader path that used to load nothing.
 *
 * App.tsx set the tool and then called a callback that read `s.selectedTool` from the previous
 * render, so every file picked or dropped on the dashboard was discarded in silence. The browser
 * proof is scripts/feature-audit/uploader-check.mjs; these cases pin the contract this component
 * owns: hand the app the tool id it chose AND the files, and let the same file be chosen twice.
 */
const pdf = (name: string) => new File(['%PDF-1.4\n'], name, { type: 'application/pdf' });

function mount() {
  const onSelectFilesAndTool = vi.fn().mockResolvedValue(undefined);
  render(<ToolDashboard onSelectTool={vi.fn()} onSelectFilesAndTool={onSelectFilesAndTool} />);
  // "Merge PDF" is also the title of a Popular Tools card, so take the tab (its label is a SPAN).
  const tabLabel = screen.getAllByText('Merge PDF').find((el) => el.tagName === 'SPAN') as HTMLElement;
  fireEvent.click(tabLabel.closest('button') as HTMLElement);
  const zone = screen.getByRole('button', { name: 'Upload PDF document' });
  const input = zone.querySelector('input[type="file"]') as HTMLInputElement;
  return { onSelectFilesAndTool, zone, input };
}

describe('dashboard uploader', () => {
  // This suite renders the same component in every case and the repo configures no global RTL
  // cleanup, so mounts would otherwise accumulate and every query after the first would be ambiguous.
  afterEach(cleanup);

  it('hands the app the tab-selected tool and both dropped files', async () => {
    const { onSelectFilesAndTool, zone } = mount();
    fireEvent.drop(zone, { dataTransfer: { files: [pdf('a.pdf'), pdf('b.pdf')] } } as never);

    await waitFor(() => expect(onSelectFilesAndTool).toHaveBeenCalled());
    const [toolId, files] = onSelectFilesAndTool.mock.calls[0] as [string, File[]];
    expect(toolId).toBe('merge');
    expect(files).toHaveLength(2);
  });

  it('accepts more than one file from the picker, because merge needs two', () => {
    const { input } = mount();
    expect(input.multiple).toBe(true);
  });

  it('clears its own value so choosing the same file twice fires a second time', async () => {
    const { onSelectFilesAndTool, input } = mount();

    fireEvent.change(input, { target: { files: [pdf('same.pdf')] } });
    await waitFor(() => expect(onSelectFilesAndTool).toHaveBeenCalledTimes(1));
    // A browser fires no change event when the selected path is unchanged and the value still holds
    // it -- this reset is what keeps a re-upload after clearing the queue from looking dead.
    expect(input.value).toBe('');

    fireEvent.change(input, { target: { files: [pdf('same.pdf')] } });
    await waitFor(() => expect(onSelectFilesAndTool).toHaveBeenCalledTimes(2));
  });

  it('ignores non-PDF drops instead of loading them into the queue', async () => {
    const { onSelectFilesAndTool, zone } = mount();
    fireEvent.drop(zone, { dataTransfer: { files: [new File(['x'], 'notes.txt', { type: 'text/plain' })] } } as never);
    await new Promise((r) => setTimeout(r, 30));
    expect(onSelectFilesAndTool).not.toHaveBeenCalled();
  });
});
