'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULTS = {
  x: null,
  y: null,
  scale: 0.72,
  skin: 'whale',
  alwaysOnTop: true,
  allowSwitch: false,
  autoLaunch: false,
  showBubble: true,
  showLive: true,
  showWorkbuddy: true,
  dailyBowls: 0,
  restRemind: true,
  allowReply: false,
  voice: true,
  voiceRate: 1.05,
  voiceEngine: 'edge',
  voiceName: 'zh-CN-XiaoxiaoNeural',
  cardOpen: false,
};

let file = null;
let cache = { ...DEFAULTS };

function init() {
  file = path.join(app.getPath('userData'), 'config.json');
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    cache = { ...DEFAULTS, ...raw };
  } catch (_) {
    cache = { ...DEFAULTS };
  }
  return cache;
}

function get() {
  return { ...cache };
}

function set(patch) {
  cache = { ...cache, ...patch };
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(cache, null, 2), 'utf8');
  } catch (_) {}
  return { ...cache };
}

module.exports = { init, get, set, DEFAULTS };
