// Synthetic security fixtures; never rendered or sent to an external service.
module.exports = [
  {
    name: 'SMIL namespace-prefixed animation',
    html: '<svg><a href="#safe"><svg:animate attributeName="href" values="#safe;javascript:alert(1)" dur=".01s" fill="freeze"/><text>Click</text></a></svg>',
    advisoryOptions: {
      allowedTags: false,
      allowedAttributes: false,
      allowedSchemes: ['http', 'https'],
      allowVulnerableTags: true,
    },
  },
  {
    name: 'noscript implied ancestor close',
    html: '<div><noscript></div><a href="https://example.test/hidden">Hidden</a></noscript><p>Visible</p>',
    advisoryOptions: {
      allowedTags: ['div', 'a', 'p'],
      allowedAttributes: { a: ['href'] },
      nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript'],
    },
  },
  {
    name: 'meta refresh javascript URL',
    html: '<meta http-equiv="refresh" content="0;url=javascript:alert(1)"><p>Visible</p>',
    advisoryOptions: {
      allowedTags: ['meta', 'p'],
      allowedAttributes: { meta: ['http-equiv', 'content'] },
    },
  },
  {
    name: 'meta refresh data URL',
    html: '<meta http-equiv="refresh" content="0;url=data:text/html,synthetic"><p>Visible</p>',
    advisoryOptions: {
      allowedTags: ['meta', 'p'],
      allowedAttributes: { meta: ['http-equiv', 'content'] },
    },
  },
  {
    name: 'javascript anchor',
    html: '<p><a href="javascript:alert(1)">Link</a></p>',
  },
  {
    name: 'encoded javascript anchor',
    html: '<p><a href="jav&#x61;script:alert(1)">Link</a></p>',
  },
  {
    name: 'data anchor',
    html: '<p><a href="data:text/html,synthetic">Link</a></p>',
  },
  {
    name: 'valid product description',
    valid: true,
    html: '<h2>Fresh fruit</h2><p>Sweet &amp; fresh <strong>fruit</strong><br><em>Daily</em> <b>ripe</b> <i>local</i> <u>selected</u> <s>old label</s></p><ul><li>Apple</li><li>Pear</li></ul><ol><li>Wash</li></ol><blockquote>Keep cool</blockquote><h3>Details</h3><h4>Contact</h4><p><a href="https://example.test/product" title="Product">HTTPS</a> <a href="http://example.test/info">HTTP</a> <a href="mailto:shop@example.test">Email</a></p>',
  },
  {
    name: 'valid brand description with relative links',
    valid: true,
    html: '<p>Local growers: <a href="/products?brand=fruit&amp;page=1" title="Browse">Browse</a> <a href="#details">Details</a></p>',
  },
];
