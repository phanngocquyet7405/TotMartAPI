const {
  displayNameIndex,
  inspectIdentity,
  report,
  applyDisposable,
  rollbackDisplayIndexes,
} = require('../scripts/review-user-identity');
const {
  withGuardedIdentityDb: withDisposableIdentityDb,
} = require('./helpers/ownedIdentityMigrationFixture');

test('apply refuses an unowned target before any database operation', async () => {
  const collection = jest.fn(() => {
    throw Error('unowned target was accessed');
  });
  await expect(applyDisposable({ collection }, {})).rejects.toThrow('provisioned');
  expect(collection).not.toHaveBeenCalled();
});

test('display index classification uses single-field key and options, not its name', () => {
  expect(displayNameIndex({ name: 'unusual_legacy_key', key: { name: 1 }, unique: true })).toBe(
    true,
  );
  expect(
    displayNameIndex({
      name: 'descending_display',
      key: { name: -1 },
      unique: true,
      sparse: true,
      collation: { locale: 'en', strength: 2 },
    }),
  ).toBe(true);
  expect(displayNameIndex({ name: 'name_1', key: { name: 1, role: 1 }, unique: true })).toBe(false);
  expect(displayNameIndex({ name: 'name_1', key: { email: 1 }, unique: true })).toBe(false);
  expect(displayNameIndex({ name: 'name_1', key: { name: 1 }, unique: false })).toBe(false);
  expect(
    displayNameIndex({
      name: 'partial_display',
      key: { name: 1 },
      unique: true,
      partialFilterExpression: { isActive: true },
    }),
  ).toBe(false);
  expect(
    displayNameIndex({
      name: 'unknown_option',
      key: { name: 1 },
      unique: true,
      unreviewedOption: true,
    }),
  ).toBe(false);
});

test('dry-run/apply only on owned disposable DB keeps email and compound indexes; duplicates block rollback without touching users', async () => {
  await withDisposableIdentityDb(async (db) => {
    const users = db.collection('users');
    await users.createIndex({ email: 1 }, { unique: true });
    await users.createIndex({ name: 1 }, { unique: true, name: 'legacy_custom_display' });
    await users.createIndex({ name: 1, role: 1 }, { unique: true, name: 'name_1' });
    await users.insertOne({
      name: 'Synthetic display',
      email: ' First@Example.test ',
      role: 'user',
    });
    const plan = await inspectIdentity(db);
    expect(report(plan).proposedEmailUpdates).toBe(1);
    expect(plan.candidates.map((i) => i.name)).toEqual(['legacy_custom_display']);
    expect((await users.findOne()).email).toBe(' First@Example.test '); // dry-run did not write
    const applied = await applyDisposable(db, plan);
    expect(applied.emailUpdates).toBe(1);
    expect((await users.findOne()).email).toBe('first@example.test');
    expect((await users.listIndexes().toArray()).map((i) => i.name).sort()).toEqual([
      '_id_',
      'email_1',
      'name_1',
    ]);
    await users.insertOne({
      name: 'Synthetic display',
      email: 'second@example.test',
      role: 'merchant',
    });
    const count = await users.countDocuments();
    expect(await rollbackDisplayIndexes(db, plan)).toEqual([
      {
        index: 'legacy_custom_display',
        restored: false,
        reason: 'DUPLICATE_DISPLAY_NAMES_REVIEW_REQUIRED',
      },
    ]);
    expect(await users.countDocuments()).toBe(count);
    expect((await users.findOne({ email: 'second@example.test' })).name).toBe('Synthetic display');
    await expect(applyDisposable(db.client.db('unowned_database'), plan)).rejects.toThrow(
      'provisioned',
    );
  });
});

test('legacy canonical collisions and stale plans block all apply changes', async () => {
  await withDisposableIdentityDb(async (db) => {
    const users = db.collection('users');
    await users.createIndex({ email: 1 }, { unique: true });
    await users.createIndex({ name: 1 }, { unique: true, name: 'legacy_display' });
    await users.insertMany([
      { name: 'One fixture', email: ' Collision@Example.test ' },
      { name: 'Two fixture', email: 'collision@example.test' },
    ]);
    const plan = await inspectIdentity(db),
      summary = report(plan);
    expect(summary.ready).toBe(false);
    expect(summary.collisionGroups).toHaveLength(1);
    expect(JSON.stringify(summary)).not.toContain('Collision@');
    await expect(applyDisposable(db, plan)).rejects.toThrow('decision manifest');
    expect((await users.listIndexes().toArray()).some((i) => i.name === 'legacy_display')).toBe(
      true,
    );
    expect((await users.findOne({ name: 'One fixture' })).email).toBe(' Collision@Example.test ');
  });
  await withDisposableIdentityDb(async (db) => {
    const users = db.collection('users');
    await users.insertOne({ name: 'Initial fixture', email: ' First@Example.test ' });
    const plan = await inspectIdentity(db);
    await users.insertOne({ name: 'New fixture', email: 'new@example.test' });
    await expect(applyDisposable(db, plan)).rejects.toThrow('stale');
    expect((await users.findOne({ name: 'Initial fixture' })).email).toBe(' First@Example.test ');
  });
});

test('rollback recreates the original unique index when no duplicates arose', async () => {
  await withDisposableIdentityDb(async (db) => {
    const users = db.collection('users');
    await users.createIndex(
      { name: -1 },
      { unique: true, name: 'custom_display_desc', sparse: true },
    );
    await users.insertOne({ name: 'Unique fixture', email: 'unique@example.test' });
    const plan = await inspectIdentity(db);
    await applyDisposable(db, plan);
    expect(await rollbackDisplayIndexes(db, plan)).toEqual([
      { index: 'custom_display_desc', restored: true },
    ]);
    const restored = (await users.listIndexes().toArray()).find(
      (i) => i.name === 'custom_display_desc',
    );
    expect(restored.key).toEqual({ name: -1 });
    expect(restored.unique).toBe(true);
    expect(restored.sparse).toBe(true);
  });
});

test('unreviewed partial single-name index blocks apply without dropping it or changing email', async () => {
  await withDisposableIdentityDb(async (db) => {
    const users = db.collection('users');
    await users.createIndex(
      { name: 1 },
      { name: 'partial_name_fixture', unique: true, partialFilterExpression: { isActive: true } },
    );
    await users.insertOne({
      name: 'Partial fixture',
      email: ' Partial@Example.test ',
      isActive: true,
    });
    const plan = await inspectIdentity(db);
    expect(report(plan).ready).toBe(false);
    await expect(applyDisposable(db, plan)).rejects.toThrow('manual review');
    expect(
      (await users.listIndexes().toArray()).some((i) => i.name === 'partial_name_fixture'),
    ).toBe(true);
    expect((await users.findOne()).email).toBe(' Partial@Example.test ');
  });
});
