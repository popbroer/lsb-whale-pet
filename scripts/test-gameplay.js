'use strict';

/** 玩法层测试：成就判定、连续天数、旅行、预算、预测 */

const g = require('../src/gameplay');

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

const T0 = new Date('2026-11-13T10:00:00').getTime();

function baseCtx(over) {
  return {
    pets: 0,
    feeds: 0,
    treats: 0,
    points: 0,
    lifetimeTokens: 0,
    todayTokens: 0,
    bigMeals: 0,
    trips: 0,
    switches: 0,
    collection: [],
    days: [],
    streak: 0,
    nightOwl: false,
    unlocked: {},
    nowMs: T0,
    ...over,
  };
}

console.log('[成就判定]');
{
  ok('白板不解锁', g.evaluate(baseCtx()).length === 0);

  const a1 = g.evaluate(baseCtx({ pets: 1 })).map((x) => x.id);
  ok('摸一次解锁 first_pet', a1.includes('first_pet') && a1.length === 1, a1);

  const a2 = g.evaluate(baseCtx({ pets: 50, treats: 20, points: 80 })).map((x) => x.id);
  ok('多项同时解锁', a2.includes('pets_50') && a2.includes('treat_full') && a2.includes('rank_bond'), a2);

  const a3 = g.evaluate(baseCtx({ todayTokens: 1e7 })).map((x) => x.id);
  ok('单日千万解锁 day_10m', a3.includes('day_10m'));

  const a4 = g.evaluate(baseCtx({ todayTokens: 9.9e6 })).map((x) => x.id);
  ok('不到千万不解锁', !a4.includes('day_10m'));

  const a5 = g.evaluate(baseCtx({ pets: 1, unlocked: { first_pet: 123 } }));
  ok('已解锁的不重复发', a5.length === 0, a5);

  const a6 = g.evaluate(baseCtx({ collection: new Array(5).fill({ name: 'x' }) })).map((x) => x.id);
  ok('5 件纪念品解锁 collector_5', a6.includes('collector_5'));
}

console.log('[连续天数]');
{
  const days = ['2026-11-13', '2026-11-12', '2026-11-11'];
  ok('连吃 3 天', g.streakOf(days, T0) === 3, g.streakOf(days, T0));

  const gap = ['2026-11-13', '2026-11-11'];
  ok('断一天只算 1', g.streakOf(gap, T0) === 1, g.streakOf(gap, T0));

  const fromYesterday = ['2026-11-12', '2026-11-11'];
  ok('今天还没吃则从昨天数', g.streakOf(fromYesterday, T0) === 2, g.streakOf(fromYesterday, T0));

  ok('空数据为 0', g.streakOf([], T0) === 0);
}

console.log('[旅行]');
{
  const dest = g.destinationById('trench');
  ok('目的地存在', dest && dest.name === '深海沟');
  ok('未知目的地兜底', g.destinationById('nope').id === 'trench');

  const trip = g.startTrip(dest, { tokensAtStart: 1000, bowlsAtStart: 1 }, T0);
  ok('30 分钟后结束', trip.endsAt === T0 + 30 * 60000, trip.endsAt);
  ok('剩余时间正确', g.travelRemainMs(trip, T0 + 10 * 60000) === 20 * 60000);
  ok('到点判定完成', g.isTripDone(trip, T0 + 30 * 60000) === true);
  ok('没到点不算完成', g.isTripDone(trip, T0 + 29 * 60000) === false);

  // 固定随机源抽取稀有度
  const legend = g.rollLoot(dest, () => 0.99);
  ok('低概率抽到尾巴上的奖品', typeof legend.name === 'string' && legend.rarity === 'common', legend);

  const res = g.finishTrip({ ...trip, tokensAtStart: 1000 }, { satiety: 70 }, 31000, T0 + 30 * 60000, () => 0.5);
  ok('战报吃到 30000 token', res.tokensGained === 30000, res.tokensGained);
  ok('换算 10 碗', res.bowlsGained === 10, res.bowlsGained);
  ok('战报带地名与耗时', res.report.destName === '深海沟' && res.report.minutes === 30, res.report);
  ok('带回一件纪念品', !!res.item && !!res.item.emoji && !!res.item.rarity);

  const noFood = g.finishTrip({ ...trip, tokensAtStart: 5000 }, { satiety: 70 }, 5000, T0 + 30 * 60000, () => 0.5);
  ok('期间没吃则 0 碗且不为负', noFood.bowlsGained === 0, noFood.bowlsGained);
}

console.log('[预算与预测]');
{
  const meta = { fedToday: 6e6, bowlsToday: 2000, satiety: 50 };
  const b1 = g.budgetView(meta, 0);
  ok('未设预算不算超', b1.over === false && b1.limit === 0);

  const b2 = g.budgetView(meta, 1000);
  ok('超预算被识别', b2.over === true && b2.left === 0, b2);

  const b3 = g.budgetView({ ...meta, bowlsToday: 500 }, 1000);
  ok('没超时剩余正确', b3.over === false && b3.left === 500, b3.left);

  const noon = new Date('2026-11-13T12:00:00').getTime();
  const p = g.predictDay({ fedToday: 6e6 }, noon);
  ok('中午 600 万 → 全天 1200 万', Math.round(p.projected) === 12e6, p.projected);
  ok('预测碗数 = 4000', p.projectedBowls === 4000, p.projectedBowls);
}

console.log(`\n通过 ${pass}，失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
