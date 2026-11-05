const { fork } = require('node:child_process');

function crashMigrationChild({
  directory,
  uri,
  launch = fork,
  timeoutMs = 30000,
  cleanupMs = 5000,
}) {
  const child = launch(require.resolve('./migration-crash'), [], {
    env: { ...process.env, C1_DIRECTORY: directory, C1_MONGO_URI: uri },
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    windowsHide: true,
  });
  return new Promise((resolve, reject) => {
    let barrier = false,
      settled = false,
      failure,
      cleanupTimer;
    const timer = setTimeout(() => terminate(new Error('C1 crash barrier deadline')), timeoutMs);
    function finish(code, signal) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(cleanupTimer);
      child.off('message', onMessage);
      child.off('error', onError);
      child.off('close', onClose);
      if (failure) reject(failure);
      else
        resolve({
          pid: child.pid,
          exitCode: code,
          signal,
          barrier: 'first-write-held',
          exactChildHandle: true,
        });
    }
    function terminate(error) {
      if (settled) return;
      failure ||= error;
      clearTimeout(timer);
      try {
        if (!child.kill('SIGKILL')) failure ||= new Error('C1 exact child termination failed');
      } catch {
        failure ||= new Error('C1 exact child termination failed');
      }
      if (!settled && !cleanupTimer)
        cleanupTimer = setTimeout(() => {
          failure = new AggregateError(
            [failure].filter(Boolean),
            'C1 exact child cleanup deadline',
          );
          finish(child.exitCode, child.signalCode);
        }, cleanupMs);
    }
    function onMessage(message) {
      if (barrier || message?.event !== 'first-write-held') return;
      barrier = true;
      terminate();
    }
    function onError() {
      terminate(new Error('C1 crash child spawn/process failure'));
    }
    function onClose(code, signal) {
      if (!barrier)
        failure ||= new Error(
          `C1 child exited before crash barrier (code=${code}, signal=${signal})`,
        );
      finish(code, signal);
    }
    child.on('message', onMessage);
    child.once('error', onError);
    child.once('close', onClose);
  });
}

module.exports = { crashMigrationChild };
