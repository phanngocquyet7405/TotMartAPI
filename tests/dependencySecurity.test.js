const sanitize = require('sanitize-html');
const safeHtml = require('../src/utils/safeHtml');
const payloads = require('./helpers/sanitizePayloads');

describe('description sanitizer security and compatibility', () => {
  test.each(payloads.filter((payload) => !payload.valid))(
    '$name uses the application policy safely',
    ({ html }) => {
      const output = safeHtml(html);
      expect(output).not.toMatch(
        /<(?:svg|\w+:animate|noscript|meta|script)\b|javascript:|data:text\/html|\bon\w+=/i,
      );
      expect(output).toMatch(/Click|Visible|Link|Hidden/);
    },
  );

  test.each(payloads.filter((payload) => payload.valid))(
    '$name preserves supported content',
    ({ html }) => {
      // The existing serializer writes the HTML void element as <br />.
      expect(safeHtml(html)).toBe(html.replace('<br>', '<br />'));
    },
  );
});

describe('upstream advisory regressions with their non-default policies', () => {
  test('namespace-prefixed SMIL cannot assign an executable URL', () => {
    const payload = payloads[0];
    const output = sanitize(payload.html, payload.advisoryOptions);
    expect(output).not.toMatch(/javascript:|<svg:animate/i);
    expect(output).toContain('Click');
  });

  test('an implied ancestor close cannot reveal discarded noscript content', () => {
    const payload = payloads[1];
    const output = sanitize(payload.html, payload.advisoryOptions);
    expect(output).not.toContain('Hidden');
    expect(output).not.toContain('https://example.test/hidden');
    expect(output).toContain('<p>Visible</p>');
  });

  test.each(payloads.slice(2, 4))(
    '$name strips the embedded executable URL',
    ({ html, advisoryOptions }) => {
      const output = sanitize(html, advisoryOptions);
      expect(output).not.toMatch(/javascript:|data:text\/html/i);
      expect(output).toContain('<p>Visible</p>');
    },
  );
});
