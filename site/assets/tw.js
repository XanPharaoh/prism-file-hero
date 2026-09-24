/* Prism File Hero — shared Tailwind Play CDN theme. Loaded after the CDN script. */
tailwind.config = {
  theme: {
    extend: {
      colors: {
        ground:  'var(--ground)',
        surface: 'var(--surface)',
        sunken:  'var(--sunken)',
        ink:     'var(--ink)',
        muted:   'var(--muted)',
        accent:  'var(--accent)',
        credit:  'var(--credit)',
        line:    'var(--line)',
      },
      fontFamily: {
        display: ['Geist','Outfit','system-ui','sans-serif'],
        body:    ['Outfit','Geist','system-ui','sans-serif'],
        mono:    ['"Geist Mono"','ui-monospace','SFMono-Regular','monospace'],
      },
    }
  }
};
