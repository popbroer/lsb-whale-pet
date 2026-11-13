'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const petstate = require('./petstate');

let file = null;
let cache = null;

function init() {
  file = path.join(app.getPath('userData'), 'pet-grow.json');
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    cache = {
      ...petstate.EMPTY(),
      ...raw,
      affinity: { ...petstate.EMPTY().affinity, ...(raw.affinity || {}) },
      ledger: { ...petstate.EMPTY().ledger, ...(raw.ledger || {}) },
      extras: { ...petstate.EMPTY().extras, ...(raw.extras || {}) },
      trip: raw.trip || null,
    };
  } catch (_) {
    cache = petstate.EMPTY();
  }
  return cache;
}

function get() {
  return cache;
}

function save(next) {
  cache = next;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cache, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  } catch (_) {}
  return cache;
}

module.exports = { init, get, save };
