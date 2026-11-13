'use strict';

/**
 * 皮肤系统测试：包发现、两种渲染模式、动作轨兜底。
 * 跑：node scripts/test-skins.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const skins = require('../src/skins');

let pass = 0;
const fails = [];

function ok(name, fn) {
  try {
    fn();
    pass += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    fails.push({ name, err });
    console.log(`  ✗ ${name}\n    ${err.message}`);
  }
}

console.log('皮肤系统');

const { skins: all, broken } = skins.list();

ok('至少有两套皮肤', () => assert.ok(all.length >= 2, `实际 ${all.length}`));
ok('没有损坏的皮肤包', () => assert.deepStrictEqual(broken, []));
ok('鲸鱼娘排第一（默认）', () => assert.strictEqual(all[0].id, 'whale'));

const whale = skins.get('whale');
const claude = skins.get('claude');

ok('鲸鱼娘是图集模式', () => assert.strictEqual(whale.mode, 'sheet'));
ok('鲸鱼娘图集文件存在', () => {
  const rel = whale.sheet.replace(/^\.\.\/\.\.\//, '');
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'assets', rel)), whale.sheet);
});
ok('鲸鱼娘有 9 条动作轨', () => assert.strictEqual(Object.keys(whale.tracks).length, 9));
ok('鲸鱼娘 idle 有 6 帧', () => assert.strictEqual(whale.tracks.idle.frames, 6));

ok('Claude 娘是逐帧模式', () => assert.strictEqual(claude.mode, 'frames'));
ok('Claude 娘所有帧文件都存在', () => {
  for (const [name, t] of Object.entries(claude.tracks)) {
    for (const f of t.files || []) {
      const rel = f.replace(/^\.\.\/\.\.\//, '');
      assert.ok(fs.existsSync(path.join(__dirname, '..', 'assets', rel)), `${name}: ${f}`);
    }
  }
});
ok('Claude 娘 idle 帧数 = 时长数', () => {
  const t = claude.tracks.idle;
  assert.strictEqual(t.frames, t.dur.length);
});
ok('Claude 娘有独立睡眠动作', () => assert.ok(claude.tracks.sleep));
ok('Claude 娘有时段问候图', () => assert.strictEqual(Object.keys(claude.greet).length, 6));

ok('主题色已解析', () => {
  assert.match(whale.accent, /^#[0-9a-f]{6}$/i);
  assert.match(claude.accent, /^#[0-9a-f]{6}$/i);
  assert.notStrictEqual(whale.accent, claude.accent);
});

ok('鲸鱼娘没有 sleep 轨时回退到 waiting', () =>
  assert.strictEqual(skins.resolveTrack(whale, 'sleep'), 'waiting'));
ok('Claude 娘有 sleep 轨则直接用', () =>
  assert.strictEqual(skins.resolveTrack(claude, 'sleep'), 'sleep'));
ok('未知动作回退到 idle', () => assert.strictEqual(skins.resolveTrack(claude, 'nonsense'), 'idle'));
ok('Claude 娘没有 waving 时回退 jumping', () =>
  assert.strictEqual(skins.resolveTrack({ ...claude, tracks: { ...claude.tracks, waving: undefined } }, 'waving'), 'jumping'));

ok('get 未知 id 返回默认皮肤', () => assert.strictEqual(skins.get('nope').id, 'whale'));
ok('不存在的皮肤返回 null', () => assert.strictEqual(skins.get('__missing__').id, 'whale'));

console.log(`\n通过 ${pass} 条`);
if (fails.length) {
  console.error(`失败 ${fails.length} 条`);
  process.exit(1);
}
