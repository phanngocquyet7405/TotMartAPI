const SwaggerParser = require('@apidevtools/swagger-parser');
const Ajv = require('ajv');
async function validate() {
  const spec = await SwaggerParser.validate('docs/api.openapi.json');
  const ajv = new Ajv({ strict: false, allErrors: true });
  ajv.addFormat('email', /^[^\s@]+@[^\s@]+\.[^\s@]+$/);
  const examples = require('../docs/api-examples.json');
  const joi = require('../src/middleware/validationSchemas');
  for (const example of examples) {
    if (!ajv.validate(spec.components.schemas[example.schema], example.value))
      throw new Error('Schema example failed: ' + example.schema);
    if (example.joi && joi[example.joi].validate(example.value).error)
      throw new Error('Runtime request example failed: ' + example.schema);
  }
  for (const operations of Object.values(spec.paths))
    for (const operation of Object.values(operations)) {
      for (const field of ['x-csrf', 'x-ownership', 'x-idempotency', 'x-retry-recovery'])
        if (!operation[field]) throw new Error('Missing contract field: ' + field);
    }
  return {
    operations: Object.values(spec.paths).reduce(
      (count, operations) => count + Object.keys(operations).length,
      0,
    ),
    examples: examples.length,
  };
}
if (require.main === module)
  validate()
    .then((result) => console.log(JSON.stringify(result)))
    .catch(() => {
      console.error('API specification/example validation failed');
      process.exitCode = 1;
    });
module.exports = { validate };
