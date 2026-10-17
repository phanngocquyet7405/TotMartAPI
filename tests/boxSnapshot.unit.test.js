const mongoose = require('mongoose');
const Box = require('../src/models/Box');
const Version = require('../src/models/BoxVersion');
const { definition } = require('../src/services/boxDefinitionService');

test('snapshot survives Mongoose casting and detaches all gift policy arrays without a DB', () => {
  const sourceComboId = new mongoose.Types.ObjectId();
  const box = new Box({ name: 'Gift', descriptions: '<p>Gift</p>', stock: 5,
    value: 100000, totalItem: 1, isGift: true, sourceComboId, sourceComboVersion: 7,
    subscriptionOnly: true, internalSubscription: true,
    products: [{ productId: new mongoose.Types.ObjectId(), name: 'SKU', quantity: 2, price: 50000 }],
    giftPolicy: { bulkTiers: [{ minQuantity: 3, percent: 10 }], amenities: [{ name: 'Card', fee: 5000 }] },
  });
  const payload = definition(box);
  const snapshot = new Version({ boxId: box._id, version: 1, definition: payload });
  expect(snapshot.validateSync()).toBeUndefined();
  expect(snapshot.definition.toObject()).toMatchObject({ sourceComboId, sourceComboVersion: 7,
    subscriptionOnly: true, internalSubscription: true, giftPolicy: {
      bulkTiers: [{ minQuantity: 3, percent: 10 }], amenities: [{ name: 'Card', fee: 5000 }],
    } });
  box.giftPolicy.bulkTiers[0].percent = 90;
  box.giftPolicy.amenities[0].fee = 999;
  expect(payload.giftPolicy.bulkTiers[0].percent).toBe(10);
  expect(payload.giftPolicy.amenities[0].fee).toBe(5000);
  expect(payload.stock).toBeUndefined();
});
