const sanitize = require('sanitize-html');
module.exports = function safeHtml(value) {
  return sanitize(value || '', {
    allowedTags: ['p', 'br', 'strong', 'em', 'b', 'i', 'u', 's', 'ul', 'ol', 'li', 'blockquote', 'h2', 'h3', 'h4', 'a'],
    allowedAttributes: { a: ['href', 'title'] }, allowedSchemes: ['https', 'http', 'mailto'],
    allowProtocolRelative: false,
    transformTags: { a: sanitize.simpleTransform('a', { rel: 'noopener noreferrer' }) },
  });
};
