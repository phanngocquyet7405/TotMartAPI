jest.mock("../src/utils/sendEmail", () => jest.fn());

const request = require("supertest");
const crypto = require("crypto");
const mongoose = require("mongoose");
const app = require("../src/app");
const User = require("../src/models/User");
const sendEmail = require("../src/utils/sendEmail");
const {
  terminateUserStreams,
} = require("../src/controllers/notificationController");
const { connect, clearDatabase, closeDatabase } = require("./helpers/db");
const { createUser, signToken } = require("./helpers/factories");

const streamUsers = new Set();
const streamRequests = new Set();
const hashToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

// Keep the HTTP request open; an actual server-side response end is required.
function openStream(ticket) {
  const ready = deferred();
  const ended = deferred();
  let didEnd = false;
  // A stream can fail while another request is being awaited.
  ended.promise.catch(() => {});

  const stream = request(app)
    .get(`/api/admin/notifications/stream?ticket=${encodeURIComponent(ticket)}`)
    .buffer(true)
    .timeout({ deadline: 5000 })
    .parse((response, callback) => {
      if (response.statusCode !== 200) {
        const error = new Error(`SSE returned ${response.statusCode}`);
        ready.reject(error);
        ended.reject(error);
        response.resume();
        callback(error);
        return;
      }
      response.once("data", () => ready.resolve());
      response.once("end", () => {
        didEnd = true;
        ended.resolve();
        callback(null, "");
      });
      response.once("error", (error) => {
        ready.reject(error);
        ended.reject(error);
        callback(error);
      });
    });

  streamRequests.add(stream);
  stream.end((error) => {
    if (error) {
      ready.reject(error);
      ended.reject(error);
    }
  });
  return {
    ready: ready.promise,
    ended: ended.promise,
    get didEnd() {
      return didEnd;
    },
  };
}

beforeAll(connect);
afterEach(async () => {
  for (const userId of streamUsers) terminateUserStreams(userId);
  for (const stream of streamRequests) stream.abort();
  streamUsers.clear();
  streamRequests.clear();
  jest.resetAllMocks();
  if (mongoose.connection.readyState === 1) await clearDatabase();
});
afterAll(async () => {
  if (mongoose.connection.readyState === 1) await closeDatabase();
});

test("an older failed reset email does not invalidate a newer reset token", async () => {
  const { user } = await createUser();
  const firstSending = deferred();
  const firstDelivery = deferred();
  sendEmail
    .mockImplementationOnce(() => {
      firstSending.resolve();
      return firstDelivery.promise;
    })
    .mockResolvedValueOnce({ success: true });

  // Calling .then starts Supertest immediately; do not await this request yet.
  const firstRequest = request(app)
    .post("/api/home/forgot-password")
    .send({ email: user.email })
    .timeout({ deadline: 5000 })
    .then((response) => response);

  try {
    await Promise.race([
      firstSending.promise,
      firstRequest.then(() => {
        throw new Error("First request never reached email delivery");
      }),
    ]);
    const secondResponse = await request(app)
      .post("/api/home/forgot-password")
      .send({ email: user.email });
    expect(secondResponse.status).toBe(200);

    const secondHtml = sendEmail.mock.calls[1][2];
    const secondToken = secondHtml.match(
      /reset-password\?token=([a-f0-9]{40})/,
    )[1];

    firstDelivery.resolve({
      success: false,
      error: "Simulated delivery failure",
    });
    expect((await firstRequest).status).toBe(500);

    const saved = await User.findById(user._id);
    expect(saved.resetPasswordToken).toBe(hashToken(secondToken));
    expect(saved.resetPasswordExpires.getTime()).toBeGreaterThan(Date.now());

    // Prove the surviving token works through the real reset endpoint too.
    const reset = await request(app)
      .post(`/api/home/reset-password?token=${secondToken}`)
      .send({ password: "NewPassword123!" });
    expect(reset.status).toBe(200);
  } finally {
    firstDelivery.resolve({ success: false });
    await firstRequest.catch(() => {});
  }
});

test("password reset closes all of that user's SSE streams, but not other users' streams", async () => {
  const { user: admin } = await createUser({ role: "admin" });
  const { user: otherAdmin } = await createUser({ role: "admin" });
  streamUsers.add(String(admin._id));
  streamUsers.add(String(otherAdmin._id));

  async function ticketFor(user) {
    const response = await request(app)
      .get("/api/admin/notifications/stream-ticket")
      .set("Authorization", `Bearer ${signToken(user)}`);
    expect(response.status).toBe(200);
    return response.body.data.ticket;
  }

  const first = openStream(await ticketFor(admin));
  await first.ready;
  const second = openStream(await ticketFor(admin));
  await second.ready;
  const other = openStream(await ticketFor(otherAdmin));
  await other.ready;
  const unusedTicket = await ticketFor(admin);
  expect(first.didEnd).toBe(false);
  expect(second.didEnd).toBe(false);

  const token = crypto.randomBytes(20).toString("hex");
  await User.updateOne(
    { _id: admin._id },
    {
      $set: {
        resetPasswordToken: hashToken(token),
        resetPasswordExpires: new Date(Date.now() + 600000),
      },
    },
  );

  const response = await request(app)
    .post(`/api/home/reset-password?token=${token}`)
    .send({ password: "ReplacementPassword123!" });
  expect(response.status).toBe(200);
  expect(response.body.message).toBe("Password updated successfully");

  // No client abort/cleanup occurs before these assertions.
  await Promise.all([first.ended, second.ended]);
  expect(other.didEnd).toBe(false);

  const reopen = await request(app).get(
    `/api/admin/notifications/stream?ticket=${unusedTicket}`,
  );
  expect(reopen.status).toBe(401);
});
