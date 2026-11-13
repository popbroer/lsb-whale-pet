'use strict';

/** 进食 / 饱食度逻辑测试 */

const ps = require('../src/petstate');

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) {
    pass += 1;
    console.log('  ✓', name);
  } else {
    fail += 1;
    console.log('  ✗', name, extra === undefined ? '' : JSON.stringify(extra));
  }
}

const T0 = new Date('2026-11-13T09:00:00').getTime();
const M = ps.META_CFG;

console.log('[初始]');
{
  const m = ps.emptyMeta(T0);
  ok('初始半饱 30', m.satiety === 30);
  ok('初始无饭量', m.bowlsToday === 0 && m.fedToday === 0);
  ok('dayKey 格式', ps.dayKeyOf(T0) === '2026-11-13', ps.dayKeyOf(T0));
}

console.log('[进食]');
{
  let m = ps.emptyMeta(T0);
  const r1 = ps.feedMeta(m, 3000, T0);
  ok('3000 token = +10 饱食', r1.meta.satiety === 40, r1.meta.satiety);
  ok('3000 token = 1 碗', Math.round(r1.meta.bowlsToday) === 1, r1.meta.bowlsToday);
  ok('累计饭量记账', r1.meta.fedToday === 3000);

  const r2 = ps.feedMeta(r1.meta, 21000, T0);
  ok('7 碗后封顶 100', r2.meta.satiety === 100, r2.meta.satiety);
  ok('超出部分标记 overflow', r2.overflow === true);

  const r3 = ps.feedMeta(ps.emptyMeta(T0), 300000, T0);
  ok('单次 >=300k 记一次大餐', r3.meta.bigMeals === 1, r3.meta.bigMeals);

  const r4 = ps.feedMeta(ps.emptyMeta(T0), 299999, T0);
  ok('不足 300k 不算大餐', r4.meta.bigMeals === 0);
}

console.log('[消化]');
{
  const m = ps.feedMeta(ps.emptyMeta(T0), 9000, T0).meta; // 60
  const d1 = ps.decayMeta(m, T0 + M.decayMs - 1);
  ok('不到 12 分钟不掉', d1.lost === 0 && d1.meta.satiety === 60);

  const d2 = ps.decayMeta(m, T0 + M.decayMs);
  ok('满 12 分钟掉 1', d2.lost === 1 && d2.meta.satiety === 59, d2.meta.satiety);

  const d3 = ps.decayMeta(m, T0 + M.decayMs * 10);
  ok('10 个周期掉 10', d3.meta.satiety === 50, d3.meta.satiety);

  const d4 = ps.decayMeta(m, T0 + M.decayMs * 200);
  ok('饿到 0 不为负', d4.meta.satiety === 0);
}

console.log('[跨天]');
{
  const m = ps.feedMeta(ps.emptyMeta(T0), 9000, T0).meta;
  const r = ps.rollDay(m, T0 + 24 * 3600 * 1000, 0);
  ok('跨天重置今日饭量', r.rolled === true && r.meta.bowlsToday === 0 && r.meta.fedToday === 0, r.meta);
  ok('跨天后饱食度保留', r.meta.satiety === m.satiety);
  ok('同一天不重置', ps.rollDay(m, T0 + 3600 * 1000, 0).rolled === false);
}

console.log('[状态与视图]');
{
  const mk = (s) => ps.metaView({ ...ps.emptyMeta(T0), satiety: s });
  ok('低于 20 是饿', mk(19).state === 'hungry');
  ok('20 正好不算饿', mk(20).state === 'ok');
  ok('92 起算撑', mk(92).state === 'stuffed');
  ok('视图取整', mk(72.4).satiety === 72);

  const v = ps.metaView({ ...ps.feedMeta(ps.emptyMeta(T0), 12584495, T0).meta });
  ok('1258 万 token ≈ 4195 碗', v.bowlsToday === 4195, v.bowlsToday);
  ok('视图带碗的换算基准', v.bowlTokens === 3000);
}

console.log(`\n通过 ${pass}，失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
