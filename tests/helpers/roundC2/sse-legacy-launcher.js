const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { watcherExit } = require('/fixture/sse-deadline');
const state = { startedAt: Date.now(), records: [] };
const save = () => fs.writeFileSync('/fixture/sse-legacy-exit.json', JSON.stringify(state));
const child = spawn(
  process.execPath,
  ['--require', '/fixture/sse-client-observer.js', '/fixture/client.js', 'fault-watch'],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);
state.pid = child.pid;
save();
let output = '';
child.stdout.on('data', (data) => {
  output += data.toString();
});
child.stderr.on('data', (data) => {
  state.stderrBytes = (state.stderrBytes || 0) + data.length;
});
child.on('error', (error) => {
  state.spawnError = error.code;
  save();
});
child.on('close', (code, signal) => {
  state.childExitCode = code;
  state.signal = signal;
  state.endedAt = Date.now();
  for (const line of output.split('\n').filter((v) => v.startsWith('ROUND_B_RESULT='))) {
    const r = JSON.parse(line.slice(15));
    state.records.push({ command: r.command, passed: r.passed, name: r.name, code: r.code });
  }
  save();
  state.exitCode = watcherExit(code, state.records);
  save();
  process.exitCode = state.exitCode;
});
