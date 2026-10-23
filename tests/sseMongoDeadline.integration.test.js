jest.mock('../src/utils/notify', () => ({
  registerSseClient: jest.fn(),
  removeSseClient: jest.fn(),
  issueSseTicket: jest.fn(),
  consumeSseTicket: jest.fn(),
  revokeUserSseTickets: jest.fn(),
}));
jest.mock('../src/config/sessionPolicy', () => ({ strictSessions: () => true }));
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const { disposableMongo } = require('./helpers/disposableMongo');
const User = require('../src/models/User');
const Session = require('../src/models/AuthSession');
const controller = require('../src/controllers/notificationController');
const notify = require('../src/utils/notify');
const directory = process.env.B07_RESOURCE_FILE
  ? path.dirname(process.env.B07_RESOURCE_FILE)
  : 'artifacts/round-c2/sse-selected';
const evidenceFile = path.join(directory, 'sse-mongo-read-' + randomUUID() + '.json');
const evidence = { fixtureOnly: true, realMongo: true, manualHeartbeatInvocation: true, cases: [] };
const save = () => {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(evidenceFile, JSON.stringify(evidence, null, 2));
};
let mongo,
  credentials,
  heartbeat,
  timerSpy,
  clearSpy,
  querySpy,
  target,
  arm,
  row,
  active = 0;
const timerHandle = {};
beforeAll(async () => {
  mongo = await disposableMongo((value) => {
    evidence.resource = value;
    save();
  });
  await mongoose.connect(mongo.uri(mongo.database), { serverSelectionTimeoutMS: 5000 });
  await Promise.all([User.init(), Session.init()]);
});
beforeEach(async () => {
  jest.clearAllMocks();
  heartbeat = undefined;
  target = undefined;
  arm = undefined;
  row = undefined;
  active = 0;
  const userId = new mongoose.Types.ObjectId(),
    sid = randomUUID();
  await User.collection.insertOne({
    _id: userId,
    name: 'Synthetic SSE',
    email: randomUUID() + '@example.com',
    password: 'fixture-not-used-for-login',
    role: 'admin',
    isActive: true,
    tokenVersion: 0,
  });
  await Session.create({
    sessionId: sid,
    userId,
    refreshHash: randomUUID(),
    tokenVersion: 0,
    expiresAt: new Date(Date.now() + 86400000),
  });
  credentials = { userId: String(userId), tokenVersion: 0, sid };
  notify.consumeSseTicket.mockReturnValue(credentials);
  const interval = global.setInterval;
  timerSpy = jest.spyOn(global, 'setInterval').mockImplementation((fn, ms, ...args) => {
    if (ms === 20000) {
      heartbeat = fn;
      return timerHandle;
    }
    return interval(fn, ms, ...args);
  });
  clearSpy = jest.spyOn(global, 'clearInterval');
  const exec = mongoose.Query.prototype.exec;
  querySpy = jest.spyOn(mongoose.Query.prototype, 'exec').mockImplementation(async function (
    ...args
  ) {
    if (!target || this.model.modelName !== target || this.op !== 'findOne')
      return exec.apply(this, args);
    target = undefined;
    row.readOptions = { timeoutMS: this.getOptions().timeoutMS ?? null };
    row.readModel = this.model.modelName;
    arm = await mongo.failpoint({
      mode: { times: 1 },
      data: { failCommands: ['find'], blockConnection: true, blockTimeMS: 15000 },
    });
    active++;
    row.startedAt = Date.now();
    try {
      return await exec.apply(this, args);
    } catch (error) {
      row.errorType = error.name;
      throw error;
    } finally {
      active--;
      row.endedAt = Date.now();
      row.durationMs = row.endedAt - row.startedAt;
      save();
    }
  });
});
afterEach(async () => {
  controller.terminateAllStreams();
  querySpy?.mockRestore();
  timerSpy?.mockRestore();
  clearSpy?.mockRestore();
  await mongo.failpoint({ mode: 'off' });
  await Promise.all([User.deleteMany({}), Session.deleteMany({})]);
  save();
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.cleanup();
  save();
});
function response() {
  const res = new EventEmitter();
  res.writableEnded = false;
  res.destroyed = false;
  res.writeHead = jest.fn();
  res.write = jest.fn();
  res.end = jest.fn(() => {
    res.writableEnded = true;
    res.emit('close');
  });
  res.destroy = jest.fn(() => {
    res.destroyed = true;
    res.emit('close');
  });
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}
async function barrier() {
  const until = Date.now() + 3000;
  while (!arm) {
    if (Date.now() > until) throw Error('SSE injection not armed');
    await new Promise((r) => setTimeout(r, 10));
  }
  await mongoose.connection.db
    .admin()
    .command({ waitForFailPoint: 'failCommand', timesEntered: arm.count + 1, maxTimeMS: 3000 });
  row.serverBarrierObserved = true;
  save();
}
test.each(['User', 'AuthSession'])(
  'SSE heartbeat closes and releases resources when %s read is silent',
  async (model) => {
    row = { case: 'heartbeat', target: model };
    evidence.cases.push(row);
    target = model;
    const res = response();
    controller.streamNotifications({ _verifiedStreamTicket: credentials }, res, jest.fn());
    const pending = heartbeat();
    await barrier();
    await heartbeat();
    row.noOverlapWhilePending = active === 1;
    await pending;
    await heartbeat();
    row.pendingAfter = active;
    row.closed = res.writableEnded;
    save();
    expect(row.serverBarrierObserved).toBe(true);
    expect(row.durationMs).toBeLessThan(7500);
    expect(row.readOptions.timeoutMS).toBe(5000);
    expect(row.errorType).toBe('MongoOperationTimeoutError');
    expect(row.noOverlapWhilePending).toBe(true);
    expect(row.pendingAfter).toBe(0);
    expect(res.end).toHaveBeenCalledTimes(1);
    expect(notify.removeSseClient).toHaveBeenCalledTimes(1);
    expect(clearSpy).toHaveBeenCalledWith(timerHandle);
  },
);
test.each(['User', 'AuthSession'])(
  'SSE initial validation opens no stream when %s read is silent',
  async (model) => {
    row = { case: 'initial-validation', target: model };
    evidence.cases.push(row);
    target = model;
    const res = response(),
      next = jest.fn();
    const pending = controller.streamNotifications(
      { query: { ticket: 'synthetic-local-ticket' } },
      res,
      next,
    );
    await barrier();
    await pending;
    row.opened = res.writeHead.mock.calls.length > 0;
    save();
    expect(row.durationMs).toBeLessThan(7500);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0].name).toBe('MongoOperationTimeoutError');
    expect(res.writeHead).not.toHaveBeenCalled();
    expect(notify.registerSseClient).not.toHaveBeenCalled();
  },
);
test.each(['active', 'inactive', 'role', 'version', 'revoked', 'expired', 'missing-sid'])(
  'SSE current DB credential check preserves %s policy',
  async (kind) => {
    if (kind === 'inactive') await User.updateOne({ _id: credentials.userId }, { isActive: false });
    if (kind === 'role') await User.updateOne({ _id: credentials.userId }, { role: 'user' });
    if (kind === 'version') await User.updateOne({ _id: credentials.userId }, { tokenVersion: 1 });
    if (kind === 'revoked')
      await Session.updateOne({ sessionId: credentials.sid }, { revokedAt: new Date() });
    if (kind === 'expired')
      await Session.updateOne(
        { sessionId: credentials.sid },
        { expiresAt: new Date(Date.now() - 1000) },
      );
    if (kind === 'missing-sid') delete credentials.sid;
    const res = response();
    controller.streamNotifications({ _verifiedStreamTicket: credentials }, res, jest.fn());
    await heartbeat();
    expect(res.writableEnded).toBe(kind !== 'active');
  },
);
