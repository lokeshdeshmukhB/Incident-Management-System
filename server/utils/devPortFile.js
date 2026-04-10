const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const PORT_FILE = path.join(REPO_ROOT, '.aims-backend-port');

function writeListeningPort(port) {
  try {
    fs.writeFileSync(PORT_FILE, `${port}\n`, 'utf8');
  } catch (err) {
    // Non-fatal (e.g. read-only checkout)
  }
}

function clearPortFile() {
  try {
    fs.unlinkSync(PORT_FILE);
  } catch (_) {
    // ignore
  }
}

function registerExitCleanup() {
  // Only use `exit` so we do not override default SIGINT shutdown behavior.
  process.on('exit', () => clearPortFile());
}

module.exports = {
  writeListeningPort,
  clearPortFile,
  registerExitCleanup,
  PORT_FILE,
  REPO_ROOT,
};
