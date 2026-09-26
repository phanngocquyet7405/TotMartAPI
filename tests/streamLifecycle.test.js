const { EventEmitter } = require("events");
const mongoose = require("mongoose");
const controller = require("../src/controllers/notificationController");
const { issueSseTicket, consumeSseTicket } = require("../src/utils/notify");

function openStream(userId) {
  const response = new EventEmitter();
  response.writableEnded = false;
  response.destroyed = false;
  response.writeHead = jest.fn();
  response.write = jest.fn();
  response.end = jest.fn(() => {
    response.writableEnded = true;
    response.emit("close");
  });
  response.destroy = jest.fn(() => {
    response.destroyed = true;
    response.emit("close");
  });
  controller.streamNotifications(
    { query: { ticket: issueSseTicket(userId) } },
    response,
  );
  return response;
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test("termination closes every user tab, removes heartbeats, and revokes pending tickets", () => {
  const userId = new mongoose.Types.ObjectId();
  const first = openStream(userId);
  const second = openStream(String(userId));
  const other = openStream("another-admin");
  const pendingTicket = issueSseTicket(userId);
  try {
    expect(jest.getTimerCount()).toBe(3);
    controller.terminateUserStreams(userId);
    expect(first.end).toHaveBeenCalledTimes(1);
    expect(second.end).toHaveBeenCalledTimes(1);
    expect(other.end).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(1);
    expect(consumeSseTicket(pendingTicket)).toBeNull();
    controller.terminateUserStreams(userId);
    expect(first.end).toHaveBeenCalledTimes(1);
    const writes = first.write.mock.calls.length;
    jest.advanceTimersByTime(20000);
    expect(first.write).toHaveBeenCalledTimes(writes);
  } finally {
    controller.terminateUserStreams(userId);
    controller.terminateUserStreams("another-admin");
  }
  expect(jest.getTimerCount()).toBe(0);
});

test("a disconnected client is removed without waiting for revocation", () => {
  const response = openStream("disconnected-admin");
  response.destroy();
  expect(jest.getTimerCount()).toBe(0);
  controller.terminateUserStreams("disconnected-admin");
  expect(response.end).not.toHaveBeenCalled();
});
