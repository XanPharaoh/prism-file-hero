import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { ToolLandingView } from '../src/components/views/ToolLandingView';
import { useAppStore } from '../src/store/appStore';
import { PDFDocument } from 'pdf-lib';

describe('ToolLandingView SEO and Live Runner', () => {
  beforeEach(() => {
    useAppStore.setState({
      selectedTool: null,
      batch: [],
    });
  });

  it('renders H1 and working drop area for /merge-pdf', () => {
    render(
      <HelmetProvider>
        <MemoryRouter initialEntries={['/merge-pdf']}>
          <Routes>
            <Route path="/:toolSlug" element={<ToolLandingView />} />
          </Routes>
        </MemoryRouter>
      </HelmetProvider>
    );

    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1).toBeDefined();
    expect(h1.textContent).toMatch(/merge/i);
    expect(screen.getByText(/Drop files here/i)).toBeDefined(); // the live tool page's wording
  });

  it('renders bank statement customized SEO and live runner for /bank-statement-to-excel', () => {
    render(
      <HelmetProvider>
        <MemoryRouter initialEntries={['/bank-statement-to-excel']}>
          <Routes>
            <Route path="/:toolSlug" element={<ToolLandingView />} />
          </Routes>
        </MemoryRouter>
      </HelmetProvider>
    );

    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1.textContent).toMatch(/bank statement/i);
    expect(screen.getByText(/Drop files here/i)).toBeDefined(); // the live tool page's wording
    expect(screen.getAllByText(/reconciled/i).length).toBeGreaterThan(0);
  });

  it('supports defaultTool and isBankStatement props directly', () => {
    render(
      <HelmetProvider>
        <MemoryRouter initialEntries={['/custom-route']}>
          <Routes>
            <Route
              path="/custom-route"
              element={<ToolLandingView defaultTool="pdf-to-excel" isBankStatement={true} />}
            />
          </Routes>
        </MemoryRouter>
      </HelmetProvider>
    );

    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1.textContent).toMatch(/bank statement/i);
    expect(screen.getByText(/Drop files here/i)).toBeDefined(); // the live tool page's wording
  });

  it('renders correctly for /tools/:toolId fallback route', () => {
    render(
      <HelmetProvider>
        <MemoryRouter initialEntries={['/tools/compress']}>
          <Routes>
            <Route path="/tools/:toolId" element={<ToolLandingView />} />
          </Routes>
        </MemoryRouter>
      </HelmetProvider>
    );

    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1.textContent).toMatch(/compress/i);
    expect(screen.getByText(/Drop files here/i)).toBeDefined(); // the live tool page's wording
  });

  it('renders SEO sections: step-by-step guide, technical features, FAQs, and related tools', () => {
    render(
      <HelmetProvider>
        <MemoryRouter initialEntries={['/split-pdf']}>
          <Routes>
            <Route path="/:toolSlug" element={<ToolLandingView />} />
          </Routes>
        </MemoryRouter>
      </HelmetProvider>
    );

    // Step-by-step guide
    expect(screen.getByText(/How to Use/i)).toBeDefined();
    expect(screen.getByText(/Step 1/i)).toBeDefined();

    // FAQs
    expect(screen.getByText(/Frequently Asked Questions/i)).toBeDefined();

    // Related tools
    expect(screen.getByText(/Related Tools/i)).toBeDefined();
  });

  it('adds dropped file to store and sets selected tool', async () => {
    render(
      <HelmetProvider>
        <MemoryRouter initialEntries={['/merge-pdf']}>
          <Routes>
            <Route path="/:toolSlug" element={<ToolLandingView />} />
          </Routes>
        </MemoryRouter>
      </HelmetProvider>
    );

    const dropzone = screen.getByLabelText(/Upload/i);
    // Intake opens the document for real now, so the fixture must be a real PDF: an unreadable
    // placeholder is refused with an error toast instead of entering the batch as "0 pages".
    const fixture = await PDFDocument.create();
    fixture.addPage([200, 200]);
    const testFile = new File([new Uint8Array(await fixture.save())], 'test.pdf', { type: 'application/pdf' });

    fireEvent.drop(dropzone, {
      dataTransfer: {
        files: [testFile],
      },
    });

    expect(useAppStore.getState().selectedTool).toBe('merge');
    // Intake is async now: the drop runs the same validation and page counting the workspace
    // uses, so the batch lands a microtask (and a pdfjs open) later than it used to.
    await waitFor(() => expect(useAppStore.getState().batch.length).toBe(1));
    expect(useAppStore.getState().batch[0].fileName).toBe('test.pdf');
  });

  it('renders Tool Not Found for an unrecognized slug', () => {
    render(
      <HelmetProvider>
        <MemoryRouter initialEntries={['/non-existent-tool-xyz']}>
          <Routes>
            <Route path="/:toolSlug" element={<ToolLandingView />} />
          </Routes>
        </MemoryRouter>
      </HelmetProvider>
    );

    expect(screen.getByText(/Tool Not Found/i)).toBeDefined();
  });

  it('renders all top 10 dedicated tool landing pages correctly', () => {
    const top10Routes = [
      { path: '/merge-pdf', defaultTool: 'merge', expectedH1: /merge/i },
      { path: '/split-pdf', defaultTool: 'split', expectedH1: /split/i },
      { path: '/compress-pdf', defaultTool: 'compress', expectedH1: /compress/i },
      { path: '/pdf-to-word', defaultTool: 'pdf-to-word', expectedH1: /word/i },
      { path: '/pdf-to-excel', defaultTool: 'pdf-to-excel', expectedH1: /excel/i },
      { path: '/bank-statement-to-excel', defaultTool: 'pdf-to-excel', isBankStatement: true, expectedH1: /bank statement/i },
      { path: '/jpg-to-pdf', defaultTool: 'jpg-to-pdf', expectedH1: /jpg/i },
      { path: '/pdf-to-jpg', defaultTool: 'pdf-to-jpg', expectedH1: /jpg/i },
      { path: '/redact-pdf', defaultTool: 'redact', expectedH1: /redact/i },
      { path: '/ocr-pdf', defaultTool: 'ocr', expectedH1: /ocr/i },
    ];

    for (const r of top10Routes) {
      const { unmount } = render(
        <HelmetProvider>
          <MemoryRouter initialEntries={[r.path]}>
            <Routes>
              <Route
                path={r.path}
                element={<ToolLandingView defaultTool={r.defaultTool} isBankStatement={r.isBankStatement} />}
              />
            </Routes>
          </MemoryRouter>
        </HelmetProvider>
      );

      const h1 = screen.getByRole('heading', { level: 1 });
      expect(h1.textContent).toMatch(r.expectedH1);
      expect(screen.getByText(/Drop files here/i)).toBeDefined(); // the live tool page's wording
      unmount();
    }
  });
});
