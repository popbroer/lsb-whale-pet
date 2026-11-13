'use strict';

/**
 * 玩法层：成就、旅行、收藏、预算与休息提醒。
 * 全部是纯函数（时钟与随机源都从参数注入），方便单测。
 */

/* ------------------------------ 成就 ------------------------------ */

function hourOf(ms) {
  return new Date(ms).getHours();
}

/**
 * ctx 由调用方组装：
 * { pets, feeds, treats, points, lifetimeTokens, todayTokens, bigMeals,
 *   trips, switches, collection, days:Set<string>, nowMs, eatingNow }
 */
const ACHIEVEMENTS = [
  { id: 'first_pet', name: '初次摸头', desc: '被摸了一下，记仇（不是）', icon: '🐋', check: (c) => c.pets >= 1 },
  { id: 'pets_50', name: '头号摸鱼对象', desc: '摸头 50 次', icon: '✋', check: (c) => c.pets >= 50 },
  { id: 'feeds_10', name: '投喂熟练工', desc: '喂食 10 次', icon: '🐟', check: (c) => c.feeds >= 10 },
  { id: 'treat_full', name: '小鱼干囤积症', desc: '小鱼干存到 20 条', icon: '🍱', check: (c) => c.treats >= 20 },
  { id: 'rank_friend', name: '挚友', desc: '亲密度到 50', icon: '🎀', check: (c) => c.points >= 50 },
  { id: 'rank_bond', name: '深海羁绊', desc: '亲密度到 80', icon: '💙', check: (c) => c.points >= 80 },
  { id: 'tokens_1m', name: '第一口一百万', desc: '累计吃掉 100 万 token', icon: '🍚', check: (c) => c.lifetimeTokens >= 1e6 },
  { id: 'tokens_10m', name: '千万饭量', desc: '累计吃掉 1000 万 token', icon: '🍚', check: (c) => c.lifetimeTokens >= 1e7 },
  { id: 'day_10m', name: '今天吃撑了', desc: '单日吃掉 1000 万 token', icon: '🔥', check: (c) => c.todayTokens >= 1e7 },
  { id: 'big_meal_5', name: '大胃王', desc: '单次 30 万 token 的大餐吃到 5 次', icon: '🍖', check: (c) => c.bigMeals >= 5 },
  { id: 'trip_first', name: '第一次远行', desc: '把她送出去旅行一次', icon: '✈️', check: (c) => c.trips >= 1 },
  { id: 'trip_5', name: '环球鲸鱼', desc: '旅行 5 次', icon: '🌏', check: (c) => c.trips >= 5 },
  { id: 'switch_first', name: '换道专家', desc: '让宠物帮你切过一次供应商', icon: '🔀', check: (c) => c.switches >= 1 },
  { id: 'night_owl', name: '夜航鲸', desc: '凌晨 0–5 点还在烧 token', icon: '🌙', check: (c) => c.nightOwl === true },
  { id: 'streak_3', name: '连吃三天', desc: '连续 3 天都有饭量', icon: '📅', check: (c) => c.streak >= 3 },
  { id: 'collector_5', name: '纪念品收藏家', desc: '收集 5 件旅行纪念品', icon: '🎁', check: (c) => (c.collection || []).length >= 5 },
];

function evaluate(ctx) {
  const unlocked = [];
  for (const a of ACHIEVEMENTS) {
    if (ctx.unlocked && ctx.unlocked[a.id]) continue;
    let hit = false;
    try {
      hit = !!a.check(ctx);
    } catch (_) {
      hit = false;
    }
    if (hit) unlocked.push({ id: a.id, name: a.name, desc: a.desc, icon: a.icon });
  }
  return unlocked;
}

function achievementView(unlocked) {
  return ACHIEVEMENTS.map((a) => ({
    id: a.id,
    name: a.name,
    desc: a.desc,
    icon: a.icon,
    at: (unlocked && unlocked[a.id]) || 0,
    unlocked: !!(unlocked && unlocked[a.id]),
  }));
}

/** 连续有饭量的天数（今天算不算由 days 里是否含今天决定） */
function streakOf(days, nowMs) {
  const set = new Set(days || []);
  let streak = 0;
  const d = new Date(nowMs);
  for (let i = 0; i < 400; i += 1) {
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (set.has(key)) {
      streak += 1;
      d.setDate(d.getDate() - 1);
    } else if (i === 0) {
      // 今天还没吃，就从昨天开始数
      d.setDate(d.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

/* ------------------------------ 旅行 ------------------------------ */

const DESTINATIONS = [
  {
    id: 'trench',
    name: '深海沟',
    emoji: '🌊',
    minutes: 30,
    blurb: '去听鲸歌，顺便捡点会发光的石头。',
    loot: [
      { name: '深海珍珠', emoji: '🫧', rarity: 'rare' },
      { name: '海藻书签', emoji: '🌿', rarity: 'common' },
      { name: '鲸歌录音', emoji: '🎵', rarity: 'common' },
    ],
  },
  {
    id: 'rice',
    name: '白饭星球',
    emoji: '🍚',
    minutes: 60,
    blurb: '朝圣之地，据说整颗星球都是米饭。',
    loot: [
      { name: '巨型饭团', emoji: '🍙', rarity: 'common' },
      { name: '古法酱油', emoji: '🍶', rarity: 'rare' },
      { name: '金饭勺', emoji: '🥄', rarity: 'legend' },
    ],
  },
  {
    id: 'arctic',
    name: '北冰洋',
    emoji: '🧊',
    minutes: 120,
    blurb: '冷是冷了点，但极光很好看。',
    loot: [
      { name: '极光照片', emoji: '🌌', rarity: 'rare' },
      { name: '万年冰块', emoji: '🧊', rarity: 'common' },
      { name: '企鹅贴纸', emoji: '🐧', rarity: 'common' },
    ],
  },
  {
    id: 'volcano',
    name: '算力火山',
    emoji: '🌋',
    minutes: 90,
    blurb: '听说那里能捡到废弃的显卡。',
    loot: [
      { name: '熔岩芯片', emoji: '🔥', rarity: 'rare' },
      { name: '散热风扇', emoji: '🌀', rarity: 'common' },
      { name: '传说显卡', emoji: '🖥️', rarity: 'legend' },
    ],
  },
];

const RARITY_WEIGHT = { common: 72, rare: 23, legend: 5 };

function destinationById(id) {
  return DESTINATIONS.find((d) => d.id === id) || DESTINATIONS[0];
}

/**
 * 开始旅行。返回新的 trip 对象。
 * @param {{tokensAtStart:number, bowlsAtStart:number}} snapshot
 */
function startTrip(dest, snapshot, nowMs = Date.now()) {
  return {
    destId: dest.id,
    startedAt: nowMs,
    endsAt: nowMs + dest.minutes * 60000,
    tokensAtStart: snapshot.tokensAtStart || 0,
    bowlsAtStart: snapshot.bowlsAtStart || 0,
    loot: null,
  };
}

function travelRemainMs(trip, nowMs) {
  if (!trip) return 0;
  return Math.max(0, trip.endsAt - nowMs);
}

function isTripDone(trip, nowMs) {
  return !!trip && nowMs >= trip.endsAt;
}

/** 抽一件纪念品：稀有度加权，同一件重复出现是允许的（收藏按件数算） */
function rollLoot(dest, rand = Math.random) {
  const pool = dest.loot;
  const total = pool.reduce((s, l) => s + (RARITY_WEIGHT[l.rarity] || 1), 0);
  let r = rand() * total;
  for (const item of pool) {
    r -= RARITY_WEIGHT[item.rarity] || 1;
    if (r <= 0) return { ...item, id: `${dest.id}-${item.name}`, at: Date.now() };
  }
  return { ...pool[0], id: `${dest.id}-${pool[0].name}`, at: Date.now() };
}

/**
 * 结束旅行，生成明信片战报。
 * @returns {{report, item, bowlsGained, tokensGained}}
 */
function finishTrip(trip, meta, todayTokens, nowMs = Date.now(), rand = Math.random) {
  const dest = destinationById(trip.destId);
  const tokensGained = Math.max(0, todayTokens - (trip.tokensAtStart || 0));
  const bowlsGained = Math.round(tokensGained / 3000);
  const item = rollLoot(dest, rand);
  return {
    report: {
      destId: dest.id,
      destName: dest.name,
      destEmoji: dest.emoji,
      minutes: Math.round((nowMs - trip.startedAt) / 60000),
      tokens: tokensGained,
      bowls: bowlsGained,
      satiety: Math.round(meta.satiety),
      at: nowMs,
      text: `去了${dest.emoji}${dest.name}，${dest.blurb}`,
    },
    item,
    tokensGained,
    bowlsGained,
  };
}

/* ------------------------------ 预算 / 休息 ------------------------------ */

const BUDGET_PRESETS = [0, 1000, 3000, 5000, 8000];

function budgetView(meta, budgetBowls) {
  const bowls = meta.bowlsToday || 0;
  const over = budgetBowls > 0 && bowls > budgetBowls;
  return {
    limit: budgetBowls || 0,
    bowls,
    over,
    ratio: budgetBowls > 0 ? Math.min(1.5, bowls / budgetBowls) : 0,
    left: Math.max(0, (budgetBowls || 0) - bowls),
  };
}

/** 按当前速率预测全天饭量 */
function predictDay(meta, nowMs) {
  const start = new Date(nowMs);
  start.setHours(0, 0, 0, 0);
  const elapsedH = Math.max(0.15, (nowMs - start.getTime()) / 3600000);
  const rate = (meta.fedToday || 0) / elapsedH;
  return {
    ratePerHour: rate,
    projected: rate * 24,
    projectedBowls: Math.round((rate * 24) / 3000),
    elapsedH,
  };
}

/* ----------------------------- 食谱图鉴 ----------------------------- */

/** 模型 → 一道菜。同一个供应商的模型归一到一个菜系，未知模型按名字哈希分配 */
const DISH_TABLE = [
  { test: /gpt-6\.1/i, name: '鹅肝盖饭', emoji: '🍱', tier: 'legend' },
  { test: /gpt-5\.6/i, name: '和牛刺身', emoji: '🥩', tier: 'legend' },
  { test: /gpt-5|gpt-4o/i, name: '厚切吐司', emoji: '🍞', tier: 'rare' },
  { test: /deepseek.*flash/i, name: '深海小鱼干', emoji: '🐟', tier: 'rare' },
  { test: /deepseek/i, name: '鲸鱼拉面', emoji: '🍜', tier: 'common' },
  { test: /claude/i, name: '红茶布丁', emoji: '🍮', tier: 'rare' },
  { test: /gemini/i, name: '柠檬挞', emoji: '🍋', tier: 'rare' },
  { test: /doubao/i, name: '豆沙包', emoji: '🥟', tier: 'common' },
  { test: /qwen|glm|kimi/i, name: '杂粮饭团', emoji: '🍙', tier: 'common' },
];

const DISH_FALLBACK = [
  { name: '白米饭', emoji: '🍚', tier: 'common' },
  { name: '味增汤', emoji: '🍲', tier: 'common' },
  { name: '天妇罗', emoji: '🍤', tier: 'rare' },
  { name: '玉子烧', emoji: '🍳', tier: 'common' },
];

function dishFor(model) {
  const m = String(model || '');
  for (const d of DISH_TABLE) {
    if (d.test.test(m)) return { name: d.name, emoji: d.emoji, tier: d.tier };
  }
  let h = 0;
  for (let i = 0; i < m.length; i += 1) h = (h * 31 + m.charCodeAt(i)) >>> 0;
  const pick = DISH_FALLBACK[h % DISH_FALLBACK.length];
  return { name: pick.name, emoji: pick.emoji, tier: pick.tier };
}

module.exports = {
  DISH_TABLE,
  dishFor,
  ACHIEVEMENTS,
  evaluate,
  achievementView,
  streakOf,
  DESTINATIONS,
  destinationById,
  startTrip,
  travelRemainMs,
  isTripDone,
  rollLoot,
  finishTrip,
  BUDGET_PRESETS,
  budgetView,
  predictDay,
  hourOf,
};
