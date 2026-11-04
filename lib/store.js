// Tiny JSON-file persistence layer. Events are kept in memory and flushed to disk (debounced).
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.CROWDPULSE_DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

let db = { events: {} };
let timer = null;

function load() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(DB_FILE)) db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    if (!db.events) db.events = {};
  } catch (e) {
    console.error('Could not read database, starting fresh:', e.message);
    db = { events: {} };
  }
  return db;
}

function save() {
  if (timer) return;
  timer = setTimeout(flush, 1500);
}

function flush() {
  clearTimeout(timer);
  timer = null;
  try {
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, DB_FILE);
  } catch (e) {
    console.error('Failed to save database:', e.message);
  }
}

module.exports = {
  load,
  save,
  flush,
  get events() { return db.events; },
};
