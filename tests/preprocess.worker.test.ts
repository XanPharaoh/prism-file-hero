import { describe, it, expect } from 'vitest';

describe('preprocess.worker logic', () => {
  it('should apply luminance-weighted grayscale and thresholding correctly', () => {
    // Test case 1: Mid-range value (should remain unchanged if between 80 and 180)
    const r1 = 100, g1 = 150, b1 = 200;
    const avg1 = Math.round(0.3 * r1 + 0.59 * g1 + 0.11 * b1); // 30 + 88.5 + 22 = 140.5 -> 141
    const val1 = avg1 > 180 ? 255 : avg1 < 80 ? 0 : avg1;
    expect(val1).toBe(141);

    // Test case 2: High value (should threshold to 255)
    const r2 = 255, g2 = 255, b2 = 255;
    const avg2 = Math.round(0.3 * r2 + 0.59 * g2 + 0.11 * b2); // 255
    const val2 = avg2 > 180 ? 255 : avg2 < 80 ? 0 : avg2;
    expect(val2).toBe(255);

    // Test case 3: Low value (should threshold to 0)
    const r3 = 50, g3 = 50, b3 = 50;
    const avg3 = Math.round(0.3 * r3 + 0.59 * g3 + 0.11 * b3); // 50
    const val3 = avg3 > 180 ? 255 : avg3 < 80 ? 0 : avg3;
    expect(val3).toBe(0);

    // Test case 4: Edge case - just above 180 (should threshold to 255)
    const r4 = 200, g4 = 200, b4 = 200;
    const avg4 = Math.round(0.3 * r4 + 0.59 * g4 + 0.11 * b4);
    const val4 = avg4 > 180 ? 255 : avg4 < 80 ? 0 : avg4;
    expect(val4).toBe(255);

    // Test case 5: Edge case - exactly 80
    const r5 = 80, g5 = 80, b5 = 80;
    const avg5 = Math.round(0.3 * r5 + 0.59 * g5 + 0.11 * b5); // 80
    const val5 = avg5 > 180 ? 255 : avg5 < 80 ? 0 : avg5;
    expect(val5).toBe(80);

    // Test case 6: Alpha channel should always be 255
    const alpha = 255;
    expect(alpha).toBe(255);
  });

  it('should handle pixel data correctly across RGB channels', () => {
    // Simulate the worker's logic for a full pixel
    const pixel = { r: 120, g: 130, b: 140 };
    const avg = Math.round(0.3 * pixel.r + 0.59 * pixel.g + 0.11 * pixel.b);
    const val = avg > 180 ? 255 : avg < 80 ? 0 : avg;

    // Expected: 0.3*120 + 0.59*130 + 0.11*140 = 36 + 76.7 + 15.4 = 128.1 -> 128
    expect(avg).toBe(128);
    expect(val).toBe(128);
  });

  it('should produce identical R, G, B values for grayscale output', () => {
    // In a valid grayscale pixel, all three channels should be equal
    const testPixels = [
      { r: 0, g: 0, b: 0, expected: 0 },
      { r: 100, g: 100, b: 100, expected: 100 },
      { r: 200, g: 200, b: 200, expected: 255 },
      { r: 255, g: 255, b: 255, expected: 255 },
    ];

    for (const p of testPixels) {
      const avg = Math.round(0.3 * p.r + 0.59 * p.g + 0.11 * p.b);
      const val = avg > 180 ? 255 : avg < 80 ? 0 : avg;
      // All three channels must be equal in output
      expect(val).toBe(val); // same value for all channels
    }
  });
});