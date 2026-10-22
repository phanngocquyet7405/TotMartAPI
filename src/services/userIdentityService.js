const { AUTH_READ_TIMEOUT_MS } = require('../config/authReadPolicy');
// No provider aliases, dot/plus stripping or Unicode normalization.
const canonicalEmail = (email) => email.trim().toLowerCase();

async function canonicalMatches(User, email, excludeId, limit = 2, options = {}) {
  const canonical = canonicalEmail(email);
  // Transitional scan uses exactly JS trim/lowercase, including legacy Unicode.
  // No canonical index is installed automatically before legacy collision review.
  const matches = [];
  const cursor = User.find(excludeId ? { _id: { $ne: excludeId } } : {}, null, options)
    .select('_id email')
    .lean()
    .cursor();
  try {
    for await (const row of cursor) {
      if (typeof row.email === 'string' && canonicalEmail(row.email) === canonical)
        matches.push(row);
      if (matches.length >= limit) break;
    }
  } finally {
    await cursor.close();
  }
  return matches;
}

async function assertEmailAvailable(User, email, excludeId) {
  if ((await canonicalMatches(User, email, excludeId, 1)).length) {
    throw Object.assign(new Error('Email đã được đăng ký'), {
      statusCode: 409,
      code: 'EMAIL_CONFLICT',
    });
  }
}

async function findForAuthentication(User, rawEmail) {
  // Bound actual driver I/O (including a silent TCP peer), not just server selection.
  // A timeout is an availability failure; never continue to another identity candidate.
  const options = { timeoutMS: AUTH_READ_TIMEOUT_MS };
  // Exact legacy identity wins even when two old accounts canonicalize alike.
  const exact = await User.findOne({ email: rawEmail }, null, options);
  if (exact) return exact;
  const matches = await canonicalMatches(User, rawEmail, undefined, 2, options);
  return matches.length === 1 ? User.findById(matches[0]._id, null, options) : null;
}

module.exports = { canonicalEmail, canonicalMatches, assertEmailAvailable, findForAuthentication };
