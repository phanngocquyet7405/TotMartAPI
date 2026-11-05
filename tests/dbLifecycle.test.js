jest.mock('mongoose', () => ({ connect: jest.fn(), models: {}, connection: {
  readyState: 0, collections: { sample: { deleteMany: jest.fn() } }, close: jest.fn(), dropDatabase: jest.fn(),
} }));
jest.mock('mongodb-memory-server', () => ({ MongoMemoryReplSet: jest.fn() }));
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { connect, clearDatabase, closeDatabase } = require('./helpers/db');
afterEach(() => { jest.clearAllMocks(); delete process.env.TEST_MONGODB_URI; mongoose.connection.readyState = 0; });
test('teardown before connect never issues buffered DB commands', async () => {
  await clearDatabase(); await closeDatabase();
  expect(mongoose.connection.collections.sample.deleteMany).not.toHaveBeenCalled();
  expect(mongoose.connection.close).not.toHaveBeenCalled();
});
test('failed replica startup keeps original failure and still stops initialized resource', async () => {
  const error = new Error('replica setup failed'), stop = jest.fn().mockResolvedValue();
  MongoMemoryReplSet.mockImplementation(() => ({ start: jest.fn().mockRejectedValue(error), stop }));
  await expect(connect()).rejects.toBe(error);
  await clearDatabase(); await closeDatabase();
  expect(stop).toHaveBeenCalledTimes(1);
  expect(mongoose.connection.collections.sample.deleteMany).not.toHaveBeenCalled();
});
test('failed connection closes disposable replica without clearing a disconnected DB', async () => {
  const error = new Error('connect failed'), stop = jest.fn().mockResolvedValue();
  MongoMemoryReplSet.mockImplementation(() => ({ start: jest.fn().mockResolvedValue(), getUri: () => 'mongodb://127.0.0.1:1/test', stop }));
  mongoose.connect.mockRejectedValueOnce(error);
  await expect(connect()).rejects.toBe(error);
  await clearDatabase(); await closeDatabase();
  expect(stop).toHaveBeenCalledTimes(1);
  expect(mongoose.connection.dropDatabase).not.toHaveBeenCalled();
});
test('cleanup still closes connection and replica when dropping fixture DB fails', async () => {
  const error = new Error('fixture cleanup failed'), stop = jest.fn().mockResolvedValue();
  MongoMemoryReplSet.mockImplementation(() => ({ start: jest.fn().mockResolvedValue(), getUri: () => 'mongodb://127.0.0.1:1/test', stop }));
  mongoose.connect.mockResolvedValueOnce(); mongoose.connection.readyState = 1;
  await connect();
  mongoose.connection.dropDatabase.mockRejectedValueOnce(error);
  await expect(closeDatabase()).rejects.toBe(error);
  expect(mongoose.connection.close).toHaveBeenCalledTimes(1);
  expect(stop).toHaveBeenCalledTimes(1);
});
test('a successfully connected DB can clear fixtures, and teardown resets ownership', async () => {
  const stop = jest.fn().mockResolvedValue();
  MongoMemoryReplSet.mockImplementation(() => ({ start: jest.fn().mockResolvedValue(), getUri: () => 'mongodb://127.0.0.1:1/test', stop }));
  mongoose.connect.mockResolvedValueOnce(); mongoose.connection.readyState = 1;
  await connect(); await clearDatabase(); await closeDatabase(); await clearDatabase();
  expect(mongoose.connection.collections.sample.deleteMany).toHaveBeenCalledTimes(1);
  expect(stop).toHaveBeenCalledTimes(1);
});
