'use strict';

/**
 * 皮肤包管理。
 *
 * 每个皮肤是 assets/skins/<id>/ 下的一个目录，包含 skin.json：
 *   mode: 'sheet'  —— 一张图集，按 rows/tracks 切格（鲸鱼娘）
 *   mode: 'frames' —— 一个动作对应若干独立 PNG/WebP（Claude 娘）
 *
 * 这里只做扫描、校验和路径解析，渲染逻辑在 renderer 里。
 */

const fs = require('fs');
const path = require('path');

const SKIN_ROOT = path.join(__dirname, '..', 'assets', 'skins');

/** 渲染层需要的动作轨。缺哪个就用 fallback 补 */
const REQUIRED_TRACKS = ['idle'];

/** 情绪 → 动作轨的兜底顺序（前面的没有就用后面的） */
const TRACK_FALLBACK = {
  sleep: ['sleep', 'waiting', 'idle'],
  waiting: ['waiting', 'idle'],
  failed: ['failed', 'idle'],
  running: ['running', 'idle'],
  review: ['review', 'thinking', 'idle'],
  waving: ['waving', 'jumping', 'idle'],
  jumping: ['jumping', 'waving', 'idle'],
  thinking: ['thinking', 'review', 'idle'],
  clawd: ['clawd', 'idle'],
};

function toUrl(absPath) {
  // 渲染层用相对 index.html 的路径，统一成正斜杠
  const rel = path.relative(path.join(__dirname, '..', 'renderer'), absPath);
  return rel.split(path.sep).join('/');
}

function readSkin(dir) {
  const file = path.join(dir, 'skin.json');
  if (!fs.existsSync(file)) return null;

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return { id: path.basename(dir), broken: true, reason: `skin.json 解析失败：${err.message}` };
  }

  const id = raw.id || path.basename(dir);
  const mode = raw.mode === 'frames' ? 'frames' : 'sheet';
  const size = {
    w: Number((raw.size && raw.size.w) || 192) || 192,
    h: Number((raw.size && raw.size.h) || 208) || 208,
  };

  const tracks = {};
  for (const [name, def] of Object.entries(raw.tracks || {})) {
    if (!def) continue;
    if (mode === 'sheet') {
      const frames = Number(def.frames) || 0;
      if (!frames) continue;
      const dur = Array.isArray(def.dur) && def.dur.length ? def.dur.slice(0, frames) : new Array(frames).fill(420);
      while (dur.length < frames) dur.push(420);
      tracks[name] = { frames, dur };
    } else {
      const frames = Array.isArray(def.frames) ? def.frames : [];
      const valid = frames.filter((f) => fs.existsSync(path.join(dir, f)));
      if (!valid.length) continue;
      const dur = Array.isArray(def.dur) && def.dur.length ? def.dur.slice() : new Array(valid.length).fill(420);
      while (dur.length < valid.length) dur.push(dur[dur.length - 1] || 420);
      tracks[name] = {
        frames: valid.length,
        dur: dur.slice(0, valid.length),
        files: valid.map((f) => toUrl(path.join(dir, f))),
      };
    }
  }

  if (!Object.keys(tracks).length) {
    return { id, broken: true, reason: '没有任何可用的动作轨' };
  }
  for (const need of REQUIRED_TRACKS) {
    if (!tracks[need]) return { id, broken: true, reason: `缺少必需动作轨 ${need}` };
  }

  const greet = {};
  for (const [k, f] of Object.entries(raw.greet || {})) {
    if (fs.existsSync(path.join(dir, f))) greet[k] = toUrl(path.join(dir, f));
  }

  let sheet = null;
  let grid = null;
  if (mode === 'sheet') {
    const rel = raw.sheet || 'spritesheet.webp';
    const abs = path.join(dir, rel);
    if (!fs.existsSync(abs)) return { id, broken: true, reason: `图集缺失：${rel}` };
    sheet = toUrl(abs);
    grid = {
      cols: Number((raw.grid && raw.grid.cols) || 8),
      rows: Number((raw.grid && raw.grid.rows) || 9),
      cw: Number((raw.grid && raw.grid.cw) || 192),
      ch: Number((raw.grid && raw.grid.ch) || 208),
    };
  }

  return {
    id,
    name: raw.name || id,
    subtitle: raw.subtitle || '',
    accent: raw.accent || '#4d6bfe',
    accentDeep: raw.accentDeep || raw.accent || '#2f4ddb',
    accent2: raw.accent2 || raw.accent || '#38bdf8',
    mode,
    size,
    sheet,
    grid,
    rows: raw.rows || {},
    tracks,
    greet,
    lines: raw.lines || {},
    greetings: raw.greetings || {},
    avatar: raw.avatar && fs.existsSync(path.join(dir, raw.avatar)) ? toUrl(path.join(dir, raw.avatar)) : null,
    license: raw.license || '',
  };
}

let cache = null;

function list(force) {
  if (cache && !force) return cache;
  let dirs = [];
  try {
    dirs = fs
      .readdirSync(SKIN_ROOT, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => path.join(SKIN_ROOT, d.name));
  } catch (_) {
    dirs = [];
  }

  const ok = [];
  const broken = [];
  for (const dir of dirs) {
    const s = readSkin(dir);
    if (!s) continue;
    if (s.broken) broken.push(s);
    else ok.push(s);
  }
  ok.sort((a, b) => (a.id === 'whale' ? -1 : b.id === 'whale' ? 1 : a.name.localeCompare(b.name)));
  cache = { skins: ok, broken };
  return cache;
}

function get(id) {
  const { skins } = list();
  return skins.find((s) => s.id === id) || skins[0] || null;
}

/** 按情绪选一个实际存在的动作轨 */
function resolveTrack(skin, name) {
  if (!skin) return 'idle';
  if (skin.tracks[name]) return name;
  const chain = TRACK_FALLBACK[name] || [];
  for (const candidate of chain) {
    if (skin.tracks[candidate]) return candidate;
  }
  return 'idle';
}

module.exports = { list, get, resolveTrack, SKIN_ROOT };
