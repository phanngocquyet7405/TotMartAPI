const Ajv = require('ajv');

test('dynamic patterns honor the configured RegExp engine', () => {
  // A deterministic rejecting engine verifies dispatch without running a costly regex.
  const engine = jest.fn(() => ({ test: () => false }));
  engine.code = 'fixturePatternEngine';
  const validate = new Ajv({
    $data: true,
    validateSchema: false,
    code: { regExp: engine },
  }).compile({
    type: 'object',
    properties: {
      pattern: { type: 'string' },
      value: { type: 'string', pattern: { $data: '1/pattern' } },
    },
  });
  expect(validate({ pattern: '^allowed$', value: 'allowed' })).toBe(false);
  expect(engine).toHaveBeenCalledWith('^allowed$', 'u');
  expect(validate.errors[0].keyword).toBe('pattern');
});

test('ordinary static schema validation retains success and error behavior', () => {
  const validate = new Ajv({ strict: false, allErrors: true }).compile({
    type: 'object',
    required: ['quantity'],
    additionalProperties: false,
    properties: { quantity: { type: 'integer', minimum: 1 } },
  });
  expect(validate({ quantity: 2 })).toBe(true);
  expect(validate({ quantity: 0, unexpected: true })).toBe(false);
  expect(validate.errors.map((error) => error.keyword).sort()).toEqual([
    'additionalProperties',
    'minimum',
  ]);
});
