const SwaggerParser = require('@apidevtools/swagger-parser');
const Ajv = require('ajv');
let specification;
const validators = new Map();
async function assertResponse(path, method, response) {
  specification ||= SwaggerParser.dereference(require.resolve('../../docs/api.openapi.json'));
  const spec = await specification;
  const key = `${method} ${path} ${response.status}`;
  const schema =
    spec.paths[path]?.[method]?.responses[response.status]?.content?.['application/json']?.schema;
  if (!schema) throw new Error(`Undocumented response: ${key}`);
  if (!validators.has(key)) validators.set(key, new Ajv({ strict: false }).compile(schema));
  // Never include body, cookies, validation data or tokens in assertion output.
  if (!validators.get(key)(response.body)) throw new Error(`Response contract failed: ${key}`);
}
module.exports = { assertResponse };
