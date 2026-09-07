import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import GlitterWrap from '../../src/components/originkit/GlitterWrap';

describe('GlitterWrap Component', () => {
  beforeEach(() => {
    // Mock canvas getContext and ResizeObserver for happy-dom/jsdom
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      fillStyle: '#000',
      strokeStyle: '#fff',
      lineWidth: 1,
    });

    global.ResizeObserver = class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    } as any;
  });

  it('renders canvas element inside container with default settings', () => {
    const { container } = render(<GlitterWrap />);
    const canvas = container.querySelector('canvas');
    expect(canvas).toBeDefined();
    expect(canvas).not.toBeNull();
  });

  it('accepts custom styling and parameters without crashing', () => {
    const { container } = render(
      <GlitterWrap
        particleCount={50}
        speed={2}
        density={60}
        starSize={10}
        color1="#6366f1"
        color2="#818cf8"
        color3="#c7d2fe"
        className="test-glitter-wrap"
      />
    );
    const wrapper = container.querySelector('.test-glitter-wrap');
    expect(wrapper).toBeDefined();
    expect(wrapper).not.toBeNull();
  });
});
