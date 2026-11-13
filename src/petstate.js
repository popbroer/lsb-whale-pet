'use strict';

/**
 * 养成系统：亲密度 + 小鱼干经济。
 *
 * 数值与判定规则移植自开源项目 @linxin666/dsh-pet（Apache-2.0）的
 * src/affinity.ts 与 src/treats.ts，为适配桌面宠物做了两处调整：
 *   1. 「回合」用 cc-switch 的请求数折算（默认 5 次请求 = 1 回合）；
 *   2. 见面礼 3 条小鱼干，避免第一次打开喂不了。
 * 所有函数都是纯函数、时钟由参数注入，方便测试。
 */

/** 亲密度上限（沿用上游：不设实际封顶，方便长期陪伴） */
const AFFINITY_MAX = 999999999;

/** 段位阶梯（阈值与原作一致） */
const RANKS = [
  { min: 0, name: '幼鲸', stars: 1 },
  { min: 25, name: '伙伴', stars: 2 },
  { min: 50, name: '挚友', stars: 3 },
  { min: 80, name: '深海羁绊', stars: 4 },
  { min: 200, name: '心有灵犀', stars: 5 },
  { min: 500, name: '传说羁绊', stars: 6 },
  { min: 2000, name: '神话羁绊', stars: 7 },
  { min: 10000, name: '永恒之契', stars: 8 },
  { min: 100000, name: '鲸生共渡', stars: 9 },
];

const AFFINITY_CFG = {
  petReward: 1,
  petCooldownMs: 10000,
  feedReward: 5,
  feedCooldownMs: 30000,
  requestsPerTurn: 5,
};

/** 进食/饱食度：把 token 当白饭，参考 dsh-web-whale-maid 的 3 万 token 饱食池 */
const META_CFG = {
  bowlTokens: 3000, // 一碗白饭 = 3000 token
  perPointTokens: 300, // 300 token = 1 点饱食度（30k 填满）
  decayMs: 12 * 60 * 1000, // 每 12 分钟掉 1 点，约 20 小时饿空
  max: 100,
  hungry: 20,
  stuffed: 92,
  bigMealTokens: 300000,
  capPerPoll: 2000000,
};

const TREAT_CFG = {
  turnsPerTreat: 30,
  timeTreatMs: 5 * 60 * 60 * 1000, // 5 小时
  maxTreats: 20,
  initialTreats: 3,
};

const REMARKS = {
  pet: [
    '咕噜咕噜…被摸到鳍耳了。',
    '摸头收货，白饭 +0，心情 +1。',
    '再摸就要收费了哦（一条小鱼干）。',
    '唔…这里痒痒的。',
    '嗯，被摸的时候算力都变顺了。',
    '蹭蹭你的手心，这是回礼～',
  ],
  petCooldown: ['刚摸过啦，缓 10 秒～', '摸太快了，头会晕的。'],
  feed: [
    '咔嚓咔嚓…小鱼干比白饭香！',
    '吃到了！这条通道我帮你盯得更紧。',
    '一口一条，力气回来了。',
    '呜…咸香的，再来一条也不介意。',
  ],
  feedCooldown: ['刚吃完，30 秒后再喂～', '吃不下了，让我缓一缓。'],
  noTreat: ['小鱼干不够了，多陪我干会儿活嘛。', '库存见底了…要 30 个回合才有一条哦。'],
};

const clamp = (n) => Math.min(AFFINITY_MAX, Math.max(0, Math.round(n)));

function emptyAffinity() {
  return {
    points: 0,
    pets: 0,
    feeds: 0,
    petRejects: 0,
    feedRejects: 0,
    turns: 0,
    lastPetAt: 0,
    lastFeedAt: 0,
  };
}

function emptyLedger() {
  return { treats: 0, lastTreatGrantAt: 0, turnsAtLastTreatGrant: 0 };
}

function emptyState() {
  const now = Date.now();
  return {
    affinity: emptyAffinity(),
    ledger: { ...emptyLedger(), treats: TREAT_CFG.initialTreats },
    meta: emptyMeta(now),
    extras: {
      trips: 0,
      switches: 0,
      lifetimeTokens: 0,
      days: [],
      collection: [],
      achievements: {},
      rest: { sessionStart: 0, lastNagAt: 0 },
    },
    trip: null,
    seenRequests: 0,
    bootstrapped: false,
    bornAt: now,
  };
}

/* ---------------------------- 进食 / 饱食度 ---------------------------- */

function pad2(n) {
  return String(n).padStart(2, '0');
}

function dayKeyOf(nowMs) {
  const d = new Date(nowMs);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function emptyMeta(nowMs = Date.now()) {
  return {
    satiety: 30,
    lastDecayAt: nowMs,
    lastFedAt: 0,
    tokensSeen: 0,
    dayKey: dayKeyOf(nowMs),
    bowlsToday: 0,
    fedToday: 0,
    bigMeals: 0,
    lastNagAt: 0,
  };
}

/** 随时间自然消化，每 12 分钟掉 1 点 */
function decayMeta(meta, nowMs = Date.now()) {
  const last = meta.lastDecayAt || nowMs;
  const steps = Math.floor(Math.max(0, nowMs - last) / META_CFG.decayMs);
  if (steps <= 0) return { meta, lost: 0 };
  const satiety = Math.max(0, meta.satiety - steps);
  return { meta: { ...meta, satiety, lastDecayAt: last + steps * META_CFG.decayMs }, lost: meta.satiety - satiety };
}

/** 吃掉一批 token */
function feedMeta(meta, tokensDelta, nowMs = Date.now()) {
  const gained = tokensDelta / META_CFG.perPointTokens;
  const raw = meta.satiety + gained;
  const satiety = Math.min(META_CFG.max, Math.max(0, raw));
  const next = {
    ...meta,
    satiety,
    lastFedAt: nowMs,
    bowlsToday: meta.bowlsToday + tokensDelta / META_CFG.bowlTokens,
    fedToday: meta.fedToday + tokensDelta,
    bigMeals: meta.bigMeals + (tokensDelta >= META_CFG.bigMealTokens ? 1 : 0),
  };
  return { meta: next, gained, overflow: raw > META_CFG.max };
}

/** 跨天：重置今日饭量，水位对齐当前累计值 */
function rollDay(meta, nowMs, todayTokens) {
  const key = dayKeyOf(nowMs);
  if (meta.dayKey === key) return { meta, rolled: false };
  return {
    meta: { ...meta, dayKey: key, bowlsToday: 0, fedToday: 0, bigMeals: 0, tokensSeen: todayTokens },
    rolled: true,
  };
}

function metaState(meta) {
  if (!meta) return 'ok';
  if (meta.satiety >= META_CFG.stuffed) return 'stuffed';
  if (meta.satiety < META_CFG.hungry) return 'hungry';
  return 'ok';
}

function metaView(meta) {
  const m = meta || emptyMeta();
  return {
    satiety: Math.round(m.satiety),
    state: metaState(m),
    bowlsToday: Math.round(m.bowlsToday),
    fedToday: m.fedToday,
    bigMeals: m.bigMeals,
    bowlTokens: META_CFG.bowlTokens,
  };
}

function rankOf(points) {
  let r = RANKS[0];
  for (const c of RANKS) if (points >= c.min) r = c;
  return r;
}

function nextRankOf(points) {
  return RANKS.find((r) => r.min > points) || null;
}

function pick(pool, count) {
  return pool[Math.abs(Math.floor(count)) % pool.length];
}

/**
 * 摸头 / 喂食。
 * @returns {{state, accepted, delta, reaction, cooldownLeft, reason}}
 */
function interact(state, kind, nowMs = Date.now(), cfg = AFFINITY_CFG) {
  const next = {
    ...state,
    affinity: { ...state.affinity },
    ledger: { ...state.ledger },
  };
  const a = next.affinity;

  if (kind === 'pet') {
    const left = a.lastPetAt === 0 ? 0 : cfg.petCooldownMs - (nowMs - a.lastPetAt);
    if (left > 0) {
      a.petRejects += 1;
      return { state: next, accepted: false, delta: 0, reaction: pick(REMARKS.petCooldown, a.petRejects), cooldownLeft: left, reason: 'cooldown' };
    }
    a.lastPetAt = nowMs;
    a.pets += 1;
    a.points = clamp(a.points + cfg.petReward);
    return { state: next, accepted: true, delta: cfg.petReward, reaction: pick(REMARKS.pet, a.pets), cooldownLeft: cfg.petCooldownMs, reason: '' };
  }

  if (kind === 'feed') {
    const left = a.lastFeedAt === 0 ? 0 : cfg.feedCooldownMs - (nowMs - a.lastFeedAt);
    if (next.ledger.treats <= 0) {
      return { state: next, accepted: false, delta: 0, reaction: pick(REMARKS.noTreat, a.feeds), cooldownLeft: 0, reason: 'no-treat' };
    }
    if (left > 0) {
      a.feedRejects += 1;
      return { state: next, accepted: false, delta: 0, reaction: pick(REMARKS.feedCooldown, a.feedRejects), cooldownLeft: left, reason: 'cooldown' };
    }
    next.ledger.treats -= 1;
    a.lastFeedAt = nowMs;
    a.feeds += 1;
    a.points = clamp(a.points + cfg.feedReward);
    return { state: next, accepted: true, delta: cfg.feedReward, reaction: pick(REMARKS.feed, a.feeds), cooldownLeft: cfg.feedCooldownMs, reason: '' };
  }

  return { state: next, accepted: false, delta: 0, reaction: '', cooldownLeft: 0, reason: 'unknown' };
}

/** 按累计请求数折算回合，补发亲密度（幂等：以 turns 为水位线） */
function awardTurns(state, totalRequests, cfg = AFFINITY_CFG) {
  const target = Math.floor(Math.max(0, totalRequests) / cfg.requestsPerTurn);
  if (target <= state.affinity.turns) return { state, gained: 0 };
  const gained = target - state.affinity.turns;
  const next = {
    ...state,
    affinity: { ...state.affinity, turns: target, points: clamp(state.affinity.points + gained) },
  };
  return { state: next, gained };
}

/** 小鱼干结算：工作产出 + 时间产出，二者独立，库存封顶 */
function settleTreats(state, nowMs = Date.now(), cfg = TREAT_CFG) {
  const l = state.ledger;
  const turns = state.affinity.turns;
  const turnDelta = Math.max(0, turns - l.turnsAtLastTreatGrant);
  const workGrants = Math.floor(turnDelta / cfg.turnsPerTreat);
  const timeAnchor = l.lastTreatGrantAt === 0 ? nowMs : l.lastTreatGrantAt;
  const timeGrants = Math.floor(Math.max(0, nowMs - timeAnchor) / cfg.timeTreatMs);
  const gained = workGrants + timeGrants;

  if (gained <= 0) {
    if (l.lastTreatGrantAt === 0) {
      return { state: { ...state, ledger: { ...l, lastTreatGrantAt: nowMs } }, gained: 0 };
    }
    return { state, gained: 0 };
  }

  const ledger = {
    treats: Math.min(cfg.maxTreats, l.treats + gained),
    lastTreatGrantAt: timeGrants > 0 ? timeAnchor + timeGrants * cfg.timeTreatMs : timeAnchor,
    turnsAtLastTreatGrant: workGrants > 0 ? turns - (turnDelta % cfg.turnsPerTreat) : l.turnsAtLastTreatGrant,
  };
  return { state: { ...state, ledger }, gained };
}

/** 给 UI 的只读快照 */
function view(state, nowMs = Date.now(), cfg = AFFINITY_CFG) {
  const a = state.affinity;
  const rank = rankOf(a.points);
  const next = nextRankOf(a.points);
  const span = next ? next.min - rank.min : 0;
  const progress = next ? Math.min(1, Math.max(0, (a.points - rank.min) / span)) : 1;

  return {
    points: a.points,
    rank: rank.name,
    stars: rank.stars,
    nextRank: next ? next.name : null,
    nextAt: next ? next.min : null,
    progress,
    toNext: next ? next.min - a.points : 0,
    pets: a.pets,
    feeds: a.feeds,
    turns: a.turns,
    treats: state.ledger.treats,
    petReadyIn: a.lastPetAt === 0 ? 0 : Math.max(0, cfg.petCooldownMs - (nowMs - a.lastPetAt)),
    feedReadyIn: a.lastFeedAt === 0 ? 0 : Math.max(0, cfg.feedCooldownMs - (nowMs - a.lastFeedAt)),
    maxTreats: TREAT_CFG.maxTreats,
  };
}

module.exports = {
  META_CFG,
  emptyMeta,
  decayMeta,
  feedMeta,
  rollDay,
  metaState,
  metaView,
  dayKeyOf,
  AFFINITY_MAX,
  AFFINITY_CFG,
  TREAT_CFG,
  RANKS,
  EMPTY: emptyState,
  interact,
  awardTurns,
  settleTreats,
  rankOf,
  nextRankOf,
  view,
};
