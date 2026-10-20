const { evaluate, sourceHash } = require('../scripts/check-commerce-coverage');
const file = 'src/services/fixture.js';
const policy = {
  files: { [file]: { sourceSha256: 'fixture-hash', branches: { total: 8, covered: 6 } } },
};
const hashes = { [file]: 'fixture-hash' };
test('B06 coverage ratchet rejects lost coverage, missing modules and incompatible instrumentation', () => {
  expect(
    evaluate(policy, { [file]: { branches: { total: 8, covered: 6, skipped: 0 } } }, hashes),
  ).toEqual([]);
  for (const summary of [
    {},
    { [file]: { branches: { total: 8, covered: 5, skipped: 0 } } },
    { [file]: { branches: { total: 6, covered: 6, skipped: 0 } } },
    { [file]: { branches: { total: 8, covered: 6, skipped: 1 } } },
  ])
    expect(evaluate(policy, summary, hashes).length).toBeGreaterThan(0);
});
test('B06 coverage policy requires explicit review for changed source but is newline-portable', () => {
  expect(
    evaluate(
      policy,
      { [file]: { branches: { total: 8, covered: 8, skipped: 0 } } },
      { [file]: 'different-source' },
    ),
  ).toEqual([{ file, reason: 'source changed: explicit coverage review required' }]);
  expect(sourceHash(Buffer.from('first\r\nsecond\r\n'))).toBe(
    sourceHash(Buffer.from('first\nsecond\n')),
  );
  expect(sourceHash(Buffer.from('first\nsecond\n'))).not.toBe(
    sourceHash(Buffer.from('first\nchanged\n')),
  );
});
