// Test-only preload; execute the actual server entrypoint with dotenv disabled.
require('./noDotenv');
// Windows kill() bypasses Node signal listeners. Exercise the same registered
// SIGTERM shutdown handler via owned-child IPC; Linux sends the actual signal.
process.on('message', (message) => {
  if (message === 'fixture-sigterm') process.emit('SIGTERM');
});
