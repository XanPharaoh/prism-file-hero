import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isOriginAllowed, parseAllowedOriginSuffixes, parseAllowedOrigins } from '../worker/src/index';

const wranglerConfig = readFileSync(resolve(process.cwd(), 'worker/wrangler.toml'), 'utf8');
const configuredValue = (name: string): string => {
  const match = wranglerConfig.match(new RegExp(`^${name} = \"([^\"]*)\"$`, 'm'));
  if (!match) throw new Error(`Missing ${name} in worker/wrangler.toml`);
  return match[1];
};

describe('Worker CORS origin configuration', () => {
  it('honors deployed Pages apex and preview configuration', () => {
    const origins = parseAllowedOrigins(configuredValue('ALLOWED_ORIGINS'));
    const suffixes = parseAllowedOriginSuffixes(configuredValue('ALLOWED_ORIGIN_SUFFIXES'));

    expect(isOriginAllowed('https://prism-file-hero.pages.dev', origins, suffixes)).toBe(true);
    expect(isOriginAllowed('https://preview.prism-file-hero.pages.dev', origins, suffixes)).toBe(true);
  });

  it('allows the Capacitor Android WebView origin configured for production', () => {
    const origins = parseAllowedOrigins(configuredValue('ALLOWED_ORIGINS'));

    expect(isOriginAllowed('https://localhost', origins)).toBe(true);
  });
  it('allows only explicit configured production and local-development origins', () => {
    const origins = parseAllowedOrigins('https://prismfilehero.com, http://localhost:3000,tauri://localhost');

    expect(isOriginAllowed('https://prismfilehero.com', origins)).toBe(true);
    expect(isOriginAllowed('http://localhost:3000', origins)).toBe(true);
    expect(isOriginAllowed('tauri://localhost', origins)).toBe(true);
  });

  describe('configured Pages preview suffixes', () => {
    const origins = parseAllowedOrigins(undefined);
    const suffixes = parseAllowedOriginSuffixes('prism-file-hero.pages.dev');

    it('allows one HTTPS subdomain label', () => {
      expect(isOriginAllowed('https://preview.prism-file-hero.pages.dev', origins, suffixes)).toBe(true);
    });

    it.each([
      'https://prism-file-hero.pages.dev',
      'https://nested.preview.prism-file-hero.pages.dev',
      'http://preview.prism-file-hero.pages.dev',
      'https://preview.prism-file-hero.pages.dev:8443',
      'https://preview.prism-file-hero.pages.dev.evil.example',
      'https://preview-prism-file-hero.pages.dev',
    ])('rejects non-preview suffix origin %s', (origin) => {
      expect(isOriginAllowed(origin, origins, suffixes)).toBe(false);
    });
  });

  it('does not allow unconfigured origins or private-network ranges', () => {
    const origins = parseAllowedOrigins('https://prismfilehero.com, http://localhost:3000');

    expect(isOriginAllowed('http://localhost:5173', origins)).toBe(false);
    expect(isOriginAllowed('http://192.168.1.10:3000', origins)).toBe(false);
    expect(isOriginAllowed('http://10.0.0.5:3000', origins)).toBe(false);
    expect(isOriginAllowed('http://172.16.0.5:3000', origins)).toBe(false);
  });

  it('trims empty configuration entries', () => {
    expect([...parseAllowedOrigins(' , https://example.test , ')]).toEqual(['https://example.test']);
  });
});
