// Invoke inside the fixture: stream events and the fault control share one clock.
function faultControl(run, clock = Date.now) {
  const faultAt = clock();
  return { run, faultAt, deadlineAt: faultAt + 65000 };
}
// Lease/backoff timestamps originate in the Docker fixture, never on the host.
async function waitUntil(
  at,
  clock = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
) {
  let now = clock();
  while (now < at) {
    await sleep(Math.min(10000, at - now));
    now = clock();
  }
  return now;
}
function remoteClosure(state, control) {
  return (
    Number.isFinite(control?.faultAt) &&
    control.deadlineAt === control.faultAt + 65000 &&
    Number.isFinite(state?.endAt) &&
    state.endAt >= control.faultAt &&
    state.endAt <= control.deadlineAt &&
    (!state.localDestroyAt || state.endAt <= state.localDestroyAt) &&
    !state.abortedAt
  );
}
function watcherExit(code, records) {
  return code === 0 && records.length === 1 && records[0].passed === true ? 0 : 1;
}
function boundedReadFailure(start, end) {
  return (
    start?.timeoutMS === 5000 &&
    end?.outcome === 'error' &&
    ['MongoOperationTimeoutError', 'MongoServerSelectionError'].includes(end.errorType) &&
    Number.isFinite(start.at) &&
    Number.isFinite(end.at) &&
    end.at >= start.at &&
    end.at - start.at < 7500
  );
}
module.exports = { faultControl, waitUntil, remoteClosure, watcherExit, boundedReadFailure };
