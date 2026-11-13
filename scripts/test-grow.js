'use strict';

/** 纯逻辑测试：亲密度冷却、小鱼干经济、段位、回合水位线 */

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

const T0 = 1_700_000_000_000;

console.log('[摸头]');
{
  let s = ps.EMPTY();
  const r1 = ps.interact(s, 'pet', T0);
  ok('第一次摸头成立', r1.accepted && r1.delta === 1, r1);
  ok('点数 +1', r1.state.affinity.points === 1);
  ok('有反应文案', typeof r1.reaction === 'string' && r1.reaction.length > 0);

  const r2 = ps.interact(r1.state, 'pet', T0 + 3000);
  ok('10 秒内被冷却拦截', !r2.accepted && r2.reason === 'cooldown', r2.reason);
  ok('被拒时不扣分', r2.state.affinity.points === 1);
  ok('冷却剩余时间合理', Math.round(r2.cooldownLeft) === 7000, r2.cooldownLeft);

  const r3 = ps.interact(r1.state, 'pet', T0 + 10000);
  ok('冷却结束可再摸', r3.accepted && r3.state.affinity.points === 2);
}

console.log('[喂食]');
{
  const s = ps.EMPTY();
  ok('见面礼 3 条', s.ledger.treats === 3);

  const f1 = ps.interact(s, 'feed', T0);
  ok('喂食成立 +5', f1.accepted && f1.delta === 5, f1);
  ok('消耗一条', f1.state.ledger.treats === 2);

  const f2 = ps.interact(f1.state, 'feed', T0 + 5000);
  ok('30 秒内被冷却拦截', !f2.accepted && f2.reason === 'cooldown');

  const empty = { ...s, ledger: { ...s.ledger, treats: 0 } };
  const f3 = ps.interact(empty, 'feed', T0);
  ok('没库存时拒绝', !f3.accepted && f3.reason === 'no-treat', f3.reason);

  const f4 = ps.interact(f1.state, 'feed', T0 + 30000);
  ok('冷却结束可再喂', f4.accepted && f4.state.ledger.treats === 1);
}

console.log('[回合折算]');
{
  let s = ps.EMPTY();
  const a1 = ps.awardTurns(s, 12);
  ok('12 次请求 = 2 回合', a1.gained === 2 && a1.state.affinity.turns === 2, a1.gained);
  ok('点数同步 +2', a1.state.affinity.points === 2);

  const a2 = ps.awardTurns(a1.state, 12);
  ok('幂等：同样请求数不再发', a2.gained === 0);

  const a3 = ps.awardTurns(a1.state, 20);
  ok('水位线推进正确', a3.gained === 2 && a3.state.affinity.turns === 4, a3.gained);
}

console.log('[小鱼干产出]');
{
  let s = ps.EMPTY();
  s = { ...s, ledger: { treats: 0, lastTreatGrantAt: T0, turnsAtLastTreatGrant: 0 } };

  // 工作产出：30 回合 1 条
  let t = ps.settleTreats({ ...s, affinity: { ...s.affinity, turns: 29 } }, T0 + 60_000);
  ok('29 回合还不够', t.gained === 0 && t.state.ledger.treats === 0, t.gained);

  t = ps.settleTreats({ ...s, affinity: { ...s.affinity, turns: 30 } }, T0 + 60_000);
  ok('30 回合产出 1 条', t.gained === 1 && t.state.ledger.treats === 1, t.gained);

  // 时间产出：5 小时 1 条
  const fiveHours = 5 * 60 * 60 * 1000;
  t = ps.settleTreats({ ...s, affinity: { ...s.affinity, turns: 0 } }, T0 + fiveHours);
  ok('5 小时产出 1 条', t.gained === 1, t.gained);

  t = ps.settleTreats({ ...s, affinity: { ...s.affinity, turns: 0 } }, T0 + fiveHours - 1000);
  ok('差 1 秒不产出', t.gained === 0);

  // 上限 20
  const rich = { ...s, ledger: { treats: 20, lastTreatGrantAt: T0, turnsAtLastTreatGrant: 0 }, affinity: { ...s.affinity, turns: 300 } };
  t = ps.settleTreats(rich, T0 + fiveHours * 3);
  ok('库存封顶 20', t.state.ledger.treats === 20, t.state.ledger.treats);

  // 首次结算不回溯历史时间
  const fresh = ps.EMPTY();
  const t0 = ps.settleTreats({ ...fresh, ledger: { treats: 0, lastTreatGrantAt: 0, turnsAtLastTreatGrant: 0 } }, T0);
  ok('首次结算只打锚点不补发', t0.gained === 0 && t0.state.ledger.lastTreatGrantAt === T0, t0.gained);
}

console.log('[段位]');
{
  const cases = [
    [0, '幼鲸', 1],
    [24, '幼鲸', 1],
    [25, '伙伴', 2],
    [50, '挚友', 3],
    [79, '挚友', 3],
    [80, '深海羁绊', 4],
    [200, '心有灵犀', 5],
    [500, '传说羁绊', 6],
    [2000, '神话羁绊', 7],
    [10000, '永恒之契', 8],
    [100000, '鲸生共渡', 9],
  ];
  for (const [pts, name, stars] of cases) {
    const r = ps.rankOf(pts);
    ok(`${pts} → ${name}`, r.name === name && r.stars === stars, r.name);
  }

  const v = ps.view({ ...ps.EMPTY(), affinity: { ...ps.EMPTY().affinity, points: 30 } });
  ok('进度 30 → 伙伴段 20%', v.nextRank === '挚友' && Math.round(v.progress * 100) === 20, v);
}

console.log(`\n通过 ${pass}，失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
