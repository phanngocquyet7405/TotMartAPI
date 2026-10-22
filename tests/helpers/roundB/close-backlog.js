const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('@babel/parser');
const { sha256 } = require('../../../scripts/evidence-manifest');
const owners = {
  'src/services/checkoutAttemptService.js': 'BE commerce/attempt và database maintainer (đề xuất)',
  'src/controllers/checkOutController.js': 'BE checkout/inventory và database maintainer (đề xuất)',
  'src/controllers/userSubscriptionController.js':
    'BE subscription và database maintainer (đề xuất)',
  'src/services/paymentReconciliationService.js':
    'BE payment/reconciliation, finance reviewer và database maintainer (đề xuất)',
  'src/services/subscriptionService.js':
    'BE subscription/fulfillment và database maintainer (đề xuất)',
  'src/jobs/orderExpiryScheduler.js': 'BE workers/inventory và database maintainer (đề xuất)',
};
function inventory(root = process.cwd()) {
  const calls = [],
    sourceHashes = {};
  for (const [file, proposedOwner] of Object.entries(owners)) {
    const bytes = fs.readFileSync(path.join(root, file));
    sourceHashes[file] = sha256(bytes);
    const tree = parse(bytes.toString('utf8'), { sourceType: 'script' });
    function walk(node, scope = 'module') {
      if (!node || typeof node !== 'object') return;
      if (['FunctionDeclaration', 'ClassMethod', 'ObjectMethod'].includes(node.type))
        scope = node.id?.name || node.key?.name || scope;
      if (
        node.type === 'CallExpression' &&
        ['transaction', 'withTransaction'].includes(node.callee.property?.name) &&
        node.arguments.length < 2
      )
        calls.push({
          file,
          line: node.loc.start.line,
          scope,
          call: node.callee.property.name,
          severity: 'P2',
          state: 'open',
          proposedOwner,
        });
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach((child) => walk(child, scope));
        else if (value && typeof value === 'object') walk(value, scope);
      }
    }
    walk(tree);
  }
  return {
    method:
      'Same files and call.arguments.length < 2 predicate as a1-verify unbudgetedTransactionCalls; not a complete timeout-option audit',
    sourceHashes,
    calls,
  };
}
module.exports = { inventory };
if (require.main === module) {
  const root = JSON.parse(fs.readFileSync('artifacts/round-b/close/current.json')).directory;
  const result = inventory();
  fs.writeFileSync(root + '/unbudgeted-transaction-calls.json', JSON.stringify(result, null, 2));
  const rows = result.calls
    .map(
      (row) =>
        `- \`${row.file}:${row.line}\` — \`${row.scope}\`, \`${row.call}\`; P2 còn mở; owner đề xuất: ${row.proposedOwner}.`,
    )
    .join('\n');
  const file = 'docs/BE-open-issues.md';
  const source = fs.readFileSync(file, 'utf8');
  if (source.includes('<!-- unbudgeted-close-start -->'))
    throw Error('Refusing to overwrite prior backlog snapshot');
  fs.appendFileSync(
    file,
    '\n### Snapshot backlog P2 khi đóng Đợt B\n\nOwner dưới đây là đề xuất, chưa phải giao việc hoặc owner đã nhận. Inventory cùng predicate với verifier A1; acceptance Q giữ issue mở, không thay read budgets hoặc chứng minh mọi nhánh đã fault-test.\n\n<!-- unbudgeted-close-start -->\n' +
      rows +
      '\n<!-- unbudgeted-close-end -->\n',
  );
  console.log(
    JSON.stringify({
      calls: result.calls.length,
      sourceFiles: Object.keys(result.sourceHashes).length,
    }),
  );
}
