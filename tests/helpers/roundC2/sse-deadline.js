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
module.exports = { remoteClosure, watcherExit, boundedReadFailure };
