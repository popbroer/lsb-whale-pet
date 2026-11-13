'use strict';

const api = window.whale;

const el = {
  card: document.getElementById('card'),
  apps: document.getElementById('apps'),
  stats: document.getElementById('stats'),
  level: document.getElementById('level-text'),
  bubble: document.getElementById('bubble'),
  bubbleText: document.getElementById('bubble-text'),
  petWrap: document.getElementById('pet-wrap'),
  petImg: document.getElementById('pet-img'),
  petFrame: document.getElementById('pet-frame'),
  dot: document.getElementById('dot'),
  btnClose: document.getElementById('btn-close'),
  btnOpenCC: document.getElementById('btn-open-cc'),
  btnMore: document.getElementById('btn-more'),
  rankName: document.getElementById('rank-name'),
  rankStars: document.getElementById('rank-stars'),
  rankBar: document.getElementById('rank-bar'),
  btnFeed: document.getElementById('btn-feed'),
  treatCount: document.getElementById('treat-count'),
  live: document.getElementById('live'),
  liveTitle: document.getElementById('live-title'),
  liveTime: document.getElementById('live-time'),
  liveText: document.getElementById('live-text'),
  liveChip: document.getElementById('live-chip'),
  intake: document.querySelector('.intake'),
  bowls: document.getElementById('bowls'),
  intakeTokens: document.getElementById('intake-tokens'),
  spark: document.getElementById('spark'),
  satBar: document.getElementById('sat-bar'),
  satVal: document.getElementById('sat-val'),
  pet: document.getElementById('pet'),
  petName: document.getElementById('pet-name'),
  petAvatar: document.getElementById('pet-avatar'),
  btnProfile: document.getElementById('btn-profile'),
  btnBills: document.getElementById('btn-bills'),
  bills: document.getElementById('bills'),
  bcHit: document.getElementById('bc-hit'),
  bcSaved: document.getElementById('bc-saved'),
  bcSub: document.getElementById('bc-sub'),
  bsList: document.getElementById('bs-list'),
  bsCount: document.getElementById('bs-count'),
  profile: document.getElementById('profile'),
  pLife: document.getElementById('p-life'),
  pTrips: document.getElementById('p-trips'),
  pAch: document.getElementById('p-ach'),
  achList: document.getElementById('ach-list'),
  colList: document.getElementById('col-list'),
  colCount: document.getElementById('col-count'),
  dishList: document.getElementById('dish-list'),
  dishCount: document.getElementById('dish-count'),
  postcard: document.getElementById('postcard'),
  pcDest: document.getElementById('pc-dest'),
  pcText: document.getElementById('pc-text'),
  pcLoot: document.getElementById('pc-loot'),
  pcClose: document.getElementById('pc-close'),
  trip: document.getElementById('trip'),
  tripEmoji: document.getElementById('trip-emoji'),
  tripName: document.getElementById('trip-name'),
  tripTime: document.getElementById('trip-time'),
  replybox: document.getElementById('replybox'),
  replyText: document.getElementById('reply-text'),
  replyTime: document.getElementById('reply-time'),
  replyClose: document.getElementById('reply-close'),
  replyCopy: document.getElementById('reply-copy'),
};

/* --------------------------- 精灵图 --------------------------- */

// 皮肤是运行时加载的（含图集模式与逐帧模式），见 src/skins.js
const FALLBACK_TORSO = { w: 192, h: 208 };

const view = {
  config: null,
  data: null,
  mood: 'idle',
  base: 'idle',
  cardOpen: false,
  scale: 0.72,
  lastSay: 0,
  lastMoodChange: Date.now(),
  expanded: new Set(),
  ignore: true,
  grow: null,
  liveStartedAt: 0,
  liveDuration: 0,
  liveVisible: false,
  meta: null,
  trip: null,
  budget: null,
  predict: null,
  profile: null,
  cardView: 'channels',
  skin: null,
  skins: [],
};

/* --------------------------- 动画器 --------------------------- */

const anim = {
  track: null,
  frame: 0,
  timer: null,
  once: false,
  onEnd: null,
  preloaded: new Set(),

  /** 预载逐帧模式的图片，避免切帧时闪白 */
  preload(skin) {
    if (!skin || skin.mode !== 'frames') return;
    for (const t of Object.values(skin.tracks)) {
      for (const f of t.files || []) {
        if (this.preloaded.has(f)) continue;
        this.preloaded.add(f);
        const img = new Image();
        img.src = f;
      }
    }
  },

  applyScale(scale) {
    view.scale = scale;
    const skin = view.skin;
    const size = (skin && skin.size) || FALLBACK_TORSO;
    const s = scale;
    const w = Math.round(size.w * s);
    const h = Math.round(size.h * s);

    el.petImg.style.width = `${w}px`;
    el.petImg.style.height = `${h}px`;
    el.petImg.style.backgroundSize = '';
    if (view.skin && view.skin.mode === 'sheet' && view.skin.grid) {
      const g = view.skin.grid;
      const cols = g.cols;
      const rows = g.rows;
      el.petImg.style.backgroundSize = `${g.cw * cols * s}px ${g.ch * rows * s}px`;
    }
    el.petWrap.style.height = `${h + 18}px`;
    this.draw();
  },

  draw() {
    if (this.track == null || !view.skin) return;
    const t = view.skin.tracks[this.track];
    if (!t) return;
    const s = view.scale;

    if (view.skin.mode === 'sheet') {
      const row = (view.skin.rows && view.skin.rows[this.track]) ?? 0;
      const g = view.skin.grid || { cw: 192, ch: 208 };
      el.petImg.style.backgroundPosition = `${-this.frame * g.cw * s}px ${-row * g.ch * s}px`;
      return;
    }

    const files = t.files || [];
    const src = files[this.frame % Math.max(1, files.length)];
    if (src) el.petFrame.src = src;
  },

  /** 把情绪名解析成实际存在的动作轨（皮肤可以只提供一部分） */
  resolve(name) {
    const skin = view.skin;
    if (!skin) return null;
    if (skin.tracks[name]) return name;
    const chain = {
      sleep: ['sleep', 'waiting', 'idle'],
      waiting: ['waiting', 'idle'],
      failed: ['failed', 'idle'],
      running: ['running', 'idle'],
      review: ['review', 'thinking', 'idle'],
      waving: ['waving', 'jumping', 'idle'],
      jumping: ['jumping', 'waving', 'idle'],
      thinking: ['thinking', 'review', 'idle'],
      clawd: ['clawd', 'idle'],
    }[name] || ['idle'];
    for (const c of chain) if (skin.tracks[c]) return c;
    return 'idle';
  },

  play(name, opts = {}) {
    const track = this.resolve(name);
    if (!track) return;
    if (!opts.force && this.track === track && !opts.once) return;
    clearTimeout(this.timer);
    this.track = track;
    this.frame = 0;
    this.once = !!opts.once;
    this.onEnd = opts.onEnd || null;
    this.draw();
    this.schedule();
  },

  schedule() {
    const t = view.skin && view.skin.tracks[this.track];
    if (!t) return;
    if (t.frames <= 1) {
      // 单帧皮肤：没有循环，但 once 动作也要正常回调
      if (this.once) {
        const cb = this.onEnd;
        this.once = false;
        this.onEnd = null;
        this.timer = setTimeout(() => {
          this.play(view.base, { force: true });
          if (cb) cb();
        }, Math.max(320, (t.dur && t.dur[0]) || 600));
      }
      return;
    }
    const dur = (t.dur && t.dur[this.frame]) || 500;
    this.timer = setTimeout(() => {
      const last = this.frame >= t.frames - 1;
      if (last) {
        if (this.once) {
          const cb = this.onEnd;
          this.once = false;
          this.onEnd = null;
          this.play(view.base, { force: true });
          if (cb) cb();
          return;
        }
        this.frame = 0;
      } else {
        this.frame += 1;
      }
      this.draw();
      this.schedule();
    }, dur);
  },
};

/* --------------------------- 皮肤 --------------------------- */

function applySkin(skin) {
  if (!skin || !skin.tracks) return;
  const changed = !view.skin || view.skin.id !== skin.id;
  view.skin = skin;

  // 主题色跟着皮肤走
  const root = document.documentElement.style;
  root.setProperty('--blue', skin.accent || '#4d6bfe');
  root.setProperty('--blue-deep', skin.accentDeep || skin.accent || '#2f4ddb');
  root.setProperty('--cyan', skin.accent2 || '#38bdf8');
  root.setProperty('--line', hexToRgba(skin.accent || '#4d6bfe', 0.16));

  if (skin.mode === 'sheet') {
    el.petFrame.classList.add('hidden');
    el.petImg.classList.remove('sheet-hidden');
    el.petImg.style.backgroundImage = `url("${skin.sheet}")`;
    el.petImg.style.backgroundRepeat = 'no-repeat';
  } else {
    el.petImg.classList.add('sheet-hidden');
    el.petFrame.classList.remove('hidden');
    el.petImg.style.backgroundImage = 'none';
    anim.preload(skin);
    const first = skin.tracks.idle && skin.tracks.idle.files && skin.tracks.idle.files[0];
    if (first) el.petFrame.src = first;
  }

  if (el.petName) el.petName.textContent = skin.name || '鲸鱼娘';
  if (el.petAvatar) el.petAvatar.src = skin.avatar || '../assets/avatar.png';
  document.title = skin.name || '鲸鱼娘';
  el.petImg.style.imageRendering = 'auto';
  anim.track = null;
  anim.frame = 0;
  anim.applyScale(view.scale);
  refreshMood(true);
  if (changed) greetByTime();
}

function hexToRgba(hex, alpha) {
  const h = String(hex).replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return `rgba(77,107,254,${alpha})`;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** 按当前时段打招呼（只在换皮肤 / 启动 / 跨时段时触发一次） */
let greetedKey = '';
function greetByTime() {
  const skin = view.skin;
  if (!skin || !skin.greet) return;
  const hour = new Date().getHours();
  const slot =
    hour < 5 ? 'dawn' : hour < 11 ? 'morning' : hour < 13 ? 'noon' : hour < 18 ? 'afternoon' : hour < 22 ? 'evening' : 'night';
  if (greetedKey === `${skin.id}:${slot}`) return;
  greetedKey = `${skin.id}:${slot}`;
  const lines = (skin.greetings && skin.greetings[slot]) || [];
  const text = lines.length ? pick(lines) : '';
  if (text) setTimeout(() => say(esc(text), 6000), 1400);
}

/* --------------------------- 文案 --------------------------- */

const LINES = {
  idle: [
    '白饭吃饱了，随时可以开潜～',
    '待机中…要不要换条更便宜的通道？',
    '我算力很足的，就是有点想躺。',
    '所有供应商都在，挑一个顺手的吧。',
  ],
  working: ['深潜中，别催，鲸鱼在思考。', '正在烧 token…白饭给够就行。', '这条通道挺顺的，我盯着呢。'],
  failed: ['这条通道好像在漏水，点我看看？', '呜…上次请求报错了，记小本本上了。'],
  worried: ['有供应商在冒烟，赶紧处理一下～'],
  sleep: ['Zzz…我睡着的时候也算加班哦。'],
  switch: ['换好啦，锅我背。'],
};

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtTokens(n) {
  if (!n) return '0';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(n);
}

/* --------------------------- 气泡 --------------------------- */

let bubbleTimer = null;

function say(text, ms = 5200) {
  if (!view.config || !view.config.showBubble) return;
  if (view.cardOpen) return;
  if (view.liveVisible) return;
  el.bubbleText.innerHTML = text;
  el.bubble.classList.add('show');
  view.lastSay = Date.now();
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => el.bubble.classList.remove('show'), ms);
}

function hideBubble() {
  clearTimeout(bubbleTimer);
  el.bubble.classList.remove('show');
}

/* --------------------------- 状态卡 --------------------------- */

function renderCard() {
  const data = view.data;
  if (!data) return;

  if (!data.ok) {
    el.apps.innerHTML = `<div class="card-msg bad">读不到 cc-switch 数据：${esc(data.message || data.reason || '未知原因')}</div>`;
    el.stats.textContent = '等待 cc-switch…';
    el.level.textContent = '未连接';
    el.dot.classList.remove('hidden');
    el.dot.classList.add('bad');
    return;
  }

  const apps = data.apps || [];

  el.apps.innerHTML = apps
    .map((app) => {
      const cur = app.current;
      const expanded = view.expanded.has(app.appType);
      return `
      <div class="app ${expanded ? 'expanded' : ''}" data-app="${esc(app.appType)}">
        <button class="app-head" data-act="toggle" data-app="${esc(app.appType)}">
          <span class="app-label">${esc(app.label)}</span>
          <span class="pill">${cur ? esc(cur.name) : '未配置'}</span>
          <span class="chev">›</span>
        </button>
        <div class="provs">
          ${app.providers
            .map(
              (p) => `
            <button class="prov ${p.isCurrent ? 'current' : ''}" data-act="switch" data-app="${esc(app.appType)}" data-id="${esc(p.id)}" data-name="${esc(p.name)}">
              <span class="led ${p.healthy ? '' : 'bad'}"></span>
              <span class="pname">${esc(p.name)}</span>
              <span class="pstate">${p.isCurrent ? '当前' : p.healthy ? '' : '异常'}</span>
            </button>`
            )
            .join('')}
        </div>
      </div>`;
    })
    .join('');

  requestAnimationFrame(() => {
    el.apps.classList.toggle('scrollable', el.apps.scrollHeight > el.apps.clientHeight + 4);
  });

  const stats = data.stats || {};
  el.stats.textContent = `今日 ${stats.requests || 0} 次 · ${fmtTokens(stats.tokens)} tokens · $${(stats.costUsd || 0).toFixed(2)}`;
  el.stats.title = `累计 ${stats.totalRequests || 0} 次请求 · 约 ¥${((stats.costUsd || 0) * 7.1).toFixed(2)}（按 7.1 汇率）`;
  el.level.textContent = `Lv.${stats.level || 1} · 白米饭票`;

  const bad = (data.unhealthy || []).length > 0 || (data.activity && data.activity.lastErrorAt && Date.now() - data.activity.lastErrorAt < 180000);
  el.dot.classList.toggle('hidden', !bad);
  el.dot.classList.toggle('bad', !!bad);
}

function openCard() {
  tts.stop();
  view.cardOpen = true;
  view.expanded.clear();
  setCardView('channels');
  renderCard();
  el.card.classList.add('open');
  el.card.setAttribute('aria-hidden', 'false');
  hideBubble();
  anim.play('review');
}

function closeCard() {
  if (!view.cardOpen) return;
  view.cardOpen = false;
  el.card.classList.remove('open');
  el.card.setAttribute('aria-hidden', 'true');
  anim.play(view.base, { force: true });
}

function toggleCard() {
  if (view.cardOpen) closeCard();
  else openCard();
}

/* --------------------------- 今日饭量 --------------------------- */

function renderIntake(meta, daily) {
  if (meta) {
    view.meta = meta;
    const lim = view.budget && view.budget.limit ? view.budget.limit : 0;
    el.bowls.textContent = lim
      ? `${(meta.bowlsToday || 0).toLocaleString('zh-CN')}/${lim.toLocaleString('zh-CN')}`
      : (meta.bowlsToday || 0).toLocaleString('zh-CN');
    el.intake.classList.toggle('over-budget', !!(lim && meta.bowlsToday > lim));
    el.intakeTokens.textContent = `${fmtTokens(meta.fedToday)} tokens`;
    el.satBar.style.width = `${Math.max(2, Math.min(100, meta.satiety))}%`;
    el.satVal.textContent = `${meta.satiety}%`;
    el.intake.classList.toggle('hungry', meta.state === 'hungry');
    el.intake.classList.toggle('stuffed', meta.state === 'stuffed');
    const pr = view.predict;
    el.intake.title = [
      `饱食度 ${meta.satiety}%`,
      `今日吃掉 ${fmtTokens(meta.fedToday)} tokens（约 ${(meta.fedToday / meta.bowlTokens).toFixed(0)} 碗）`,
      pr ? `按当前速度全天约 ${pr.projectedBowls.toLocaleString('zh-CN')} 碗` : '',
      view.budget && view.budget.limit ? `预算 ${view.budget.limit} 碗` : '',
    ]
      .filter(Boolean)
      .join(' · ');
  }

  if (Array.isArray(daily) && daily.length) {
    const max = Math.max(...daily.map((d) => d.tokens), 1);
    el.spark.innerHTML = daily
      .map((d, i) => {
        const h = Math.max(2, Math.round((d.tokens / max) * 14));
        const isToday = i === daily.length - 1;
        return `<i class="${isToday ? 'today' : ''}" style="height:${h}px" title="${esc(d.date)} · ${fmtTokens(d.tokens)}"></i>`;
      })
      .join('');
  }
}

/* --------------------------- 回复 Codex --------------------------- */

function closeReply() {
  el.replybox.classList.remove('show');
}

async function openReply() {
  closeCard();
  hideBubble();
  const st = await api.replyStatus();
  el.replyText.textContent = (st && st.lastReply) || '还没收到回复。';
  el.replyTime.textContent = st && st.lastReplyAt ? new Date(st.lastReplyAt).toLocaleTimeString('zh-CN', { hour12: false }) : '';
  el.replyCopy.disabled = !(st && st.lastReply);
  el.replybox.classList.add('show');
}

el.replyClose.addEventListener('click', closeReply);
el.replyCopy.addEventListener('click', async () => {
  await api.copy(el.replyText.textContent);
  el.replyCopy.textContent = '已复制';
  setTimeout(() => (el.replyCopy.textContent = '复制全文'), 1400);
});

/* --------------------------- 账单 --------------------------- */

function renderBills() {
  const data = view.data;
  const bills = data && data.bills;
  if (!bills || !bills.cache) {
    el.bcHit.textContent = '--';
    el.bsList.innerHTML = '<div class="bs-empty">还没读到账单数据。</div>';
    return;
  }

  const all = bills.cache.all || {};
  const today = bills.cache.today || {};
  const pct = (v) => `${Math.round((v || 0) * 100)}%`;

  el.bcHit.textContent = pct(all.hit);
  el.bcSaved.textContent = Math.round((all.savedTokens || 0) / 3000).toLocaleString('zh-CN');
  el.bcSub.textContent = `今日 ${pct(today.hit)} · 省 ${Math.round((today.savedTokens || 0) / 1000)}k`;
  el.bcHit.title = `累计：命中 ${fmtTokens(all.read || 0)} · 未命中 ${fmtTokens(all.input || 0)}`;

  const list = bills.sessions || [];
  const projects = new Set(list.map((x) => x.project).filter(Boolean));
  // 同一个项目时不必每行重复项目名，直接放进标题栏
  const sameProject = projects.size === 1 ? [...projects][0] : '';
  el.bsCount.textContent = sameProject ? `${sameProject} · Top ${list.length}` : list.length ? `Top ${list.length}` : '';

  el.bsList.innerHTML = list.length
    ? list
        .map((x, i) => {
          const name = esc(x.title || x.project || x.short);
          const tip = [x.title, x.project, x.model, `${x.requests} 次请求`, relTime(x.lastAt), x.short]
            .filter(Boolean)
            .join(' · ');
          return `
        <div class="bs ${x.active ? 'active' : ''}" title="${esc(tip)}">
          <span class="rank">${i + 1}</span>
          <span class="proj">${name}</span>
          ${x.active ? '<span class="live-dot-sm"></span>' : ''}
          <span class="tok">${fmtTokens(x.tokens)}</span>
        </div>`;
        })
        .join('')
    : '<div class="bs-empty">还没有会话账单。</div>';
}

function relTime(ts) {
  if (!ts) return '';
  const d = Date.now() - ts;
  if (d < 60 * 1000) return '刚刚';
  if (d < 3600 * 1000) return `${Math.round(d / 60000)} 分钟前`;
  if (d < 86400 * 1000) return `${Math.round(d / 3600000)} 小时前`;
  return `${Math.round(d / 86400000)} 天前`;
}

/* --------------------------- 旅行 / 档案 --------------------------- */

let tripTimer = null;
let postcardTimer = null;
let achQueue = [];

function fmtCountdown(ms) {
  const sec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(sec / 60);
  const s2 = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s2).padStart(2, '0')}`;
}

function tickTripClock() {
  if (!view.trip) return;
  const remain = (view.trip.endsAt || 0) - Date.now();
  el.tripTime.textContent = remain > 0 ? fmtCountdown(remain) : '回来了…';
}

function renderTrip(trip) {
  view.trip = trip || null;
  const on = !!trip;
  el.trip.classList.toggle('hidden', !on);
  el.pet.classList.toggle('hidden', on);
  document.body.classList.toggle('traveling', on);

  if (on) {
    el.tripEmoji.textContent = trip.emoji || '🌊';
    el.tripName.textContent = trip.name || '旅行中';
    tickTripClock();
    if (!tripTimer) tripTimer = setInterval(tickTripClock, 1000);
    closeCard();
  } else if (tripTimer) {
    clearInterval(tripTimer);
    tripTimer = null;
  }
}

function renderProfile(profile) {
  if (!profile) return;
  view.profile = profile;

  el.pLife.textContent = profile.stats.lifetimeTokens ? fmtTokens(profile.stats.lifetimeTokens) : '0';
  el.pTrips.textContent = profile.stats.trips || 0;
  el.pAch.textContent = `${profile.unlockedCount}/${profile.total}`;

  el.achList.innerHTML = (profile.achievements || [])
    .map(
      (a) => `
      <div class="ach ${a.unlocked ? 'unlocked' : 'locked'}" title="${esc(a.desc)}">
        <span class="a-icon">${a.icon}</span>
        <span class="a-body"><b>${esc(a.name)}</b><small>${esc(a.desc)}</small></span>
      </div>`
    )
    .join('');

  const dishes = profile.dishes || [];
  el.dishCount.textContent = dishes.length;
  el.dishList.innerHTML = dishes.length
    ? dishes
        .map(
          (d) => `
      <div class="dish ${d.tier || 'common'}" title="${esc(d.model)} · 首次吃到 ${d.firstAt ? new Date(d.firstAt).toLocaleDateString('zh-CN') : '—'}">
        <span class="d-emoji">${d.emoji || '🍚'}</span>
        <span class="d-name">${esc(d.name || '白饭')}</span>
        <span class="d-model">${esc(d.model)}</span>
      </div>`
        )
        .join('')
    : '<span class="col-empty">还没吃过别的模型。</span>';

  const col = profile.collection || [];
  el.colCount.textContent = col.length;
  el.colList.innerHTML = col.length
    ? col
        .slice(-14)
        .map((c) => `<span class="chip ${c.rarity}" title="${esc(c.name)} · ${esc(c.rarity)}">${c.emoji}</span>`)
        .join('')
    : '<span class="col-empty">还没有纪念品，送她去旅行吧。</span>';
}

function setCardView(v) {
  view.cardView = v;
  const isProfile = v === 'profile';
  const isBills = v === 'bills';
  const isChannels = !isProfile && !isBills;
  el.apps.classList.toggle('hidden', !isChannels);
  el.profile.classList.toggle('hidden', !isProfile);
  el.bills.classList.toggle('hidden', !isBills);
  el.btnProfile.style.color = isProfile ? 'var(--blue)' : '';
  el.btnBills.style.color = isBills ? 'var(--blue)' : '';
  if (isProfile) api.getProfile().then(renderProfile);
  if (isBills) renderBills();
}

function showPostcard(payload) {
  if (!payload || !payload.report) return;
  const r = payload.report;
  const it = payload.item || {};
  const mins = r.minutes > 0 ? `${r.minutes} 分钟` : '刚出发就回来了';
  el.pcDest.textContent = `${r.destEmoji} ${r.destName} · ${mins}${r.early ? '（提前召回）' : ''}`;
  el.pcText.textContent = `${r.text} 这期间你吃掉了 ${r.bowls.toLocaleString('zh-CN')} 碗白饭（${fmtTokens(r.tokens)} tokens）。`;
  const rarity = { common: '普通', rare: '稀有', legend: '传说' }[it.rarity] || '普通';
  el.pcLoot.textContent = `带回来：${it.emoji} ${it.name}（${rarity}）`;
  el.postcard.classList.add('show');
  hideBubble();
  clearTimeout(postcardTimer);
  postcardTimer = setTimeout(() => el.postcard.classList.remove('show'), 12000);
  anim.play('jumping', { once: true, onEnd: () => refreshMood(true) });
}

function flushAchievements() {
  if (!achQueue.length) return;
  const batch = achQueue.splice(0, achQueue.length);
  anim.play('jumping', { once: true, onEnd: () => refreshMood(true) });
  if (batch.length === 1) say(`🏆 解锁成就：${batch[0].icon} ${esc(batch[0].name)}`, 6500);
  else say(`🏆 一口气解锁 ${batch.length} 个成就：${batch.map((b) => esc(b.name)).join('、')}`, 7500);
  if (view.cardView === 'profile') api.getProfile().then(renderProfile);
  else if (view.profile) api.getProfile().then(renderProfile);
}

/* --------------------------- 语音播报 --------------------------- */

const tts = {
  voice: null,
  picked: false,
  speaking: false,
  audio: null,
  seq: 0,

  available() {
    return typeof window.speechSynthesis !== 'undefined';
  },

  /** 系统语音兜底时挑中文音色 */
  pick() {
    if (!this.available()) return null;
    const list = window.speechSynthesis.getVoices() || [];
    if (!list.length) return null;
    const zh = list.filter((v) => /^zh/i.test(v.lang || ''));
    this.voice =
      zh.find((v) => /huihui|xiaoxiao|yaoyao|kangkang/i.test(v.name)) || zh[0] || null;
    this.picked = true;
    return this.voice;
  },

  /** 把 markdown / 代码 / 链接洗成能念的一句话 */
  clean(text) {
    let t = String(text || '');
    t = t.replace(/```[\s\S]*?```/g, ' ');
    t = t.replace(/`[^`]*`/g, ' ');
    t = t.replace(/!?\[[^\]]*\]\([^)]*\)/g, ' ');
    t = t.replace(/https?:\/\/\S+/g, ' ');
    t = t.replace(/[#>*_~|]/g, ' ');
    t = t.replace(/\s+/g, ' ').trim();
    if (!t) return '';
    if (t.length <= 90) return t;
    const cut = t.slice(-120);
    const dot = cut.search(/[。！？.!?]/);
    return dot >= 0 ? cut.slice(0, dot + 1) : cut.slice(0, 90);
  },

  /** 主路径：Edge 神经网络音色；失败自动退回系统语音 */
  async speak(text, opts = {}) {
    if (view.config && view.config.voice === false) return false;
    const line = this.clean(text);
    if (!line) return false;

    const engine = (view.config && view.config.voiceEngine) || 'edge';
    if (engine === 'edge' && api.speak) {
      const seq = ++this.seq;
      try {
        const r = await api.speak({
          text: line,
          voice: view.config.voiceName,
          rate: view.config.voiceRate,
        });
        if (seq !== this.seq) return false; // 期间又被新的一句顶掉了
        if (r && r.ok && r.url) {
          this.play(r.url);
          console.info(`[tts] edge "${line}" voice=${view.config.voiceName} cached=${r.cached}`);
          return true;
        }
        console.info('[tts] edge failed -> system', r && r.reason);
      } catch (err) {
        console.info('[tts] edge error', err && err.message);
      }
      if (seq !== this.seq) return false;
    }

    return this.speakSystem(line);
  },

  play(url) {
    this.stopAudio();
    try {
      const a = new Audio(url);
      this.audio = a;
      a.onended = () => {
        this.speaking = false;
      };
      a.onerror = () => {
        this.speaking = false;
      };
      const p = a.play();
      if (p && p.catch) {
        p.catch((err) => {
          console.info('[tts] play blocked', err && err.message);
          this.speaking = false;
        });
      }
      this.speaking = true;
    } catch (err) {
      console.info('[tts] play error', err && err.message);
    }
  },

  stopAudio() {
    if (!this.audio) return;
    try {
      this.audio.pause();
      this.audio.src = '';
    } catch (_) {}
    this.audio = null;
    this.speaking = false;
  },

  speakSystem(line) {
    if (!this.available()) return false;
    if (!this.picked) this.pick();
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(line);
      if (this.voice) u.voice = this.voice;
      u.lang = (this.voice && this.voice.lang) || 'zh-CN';
      u.rate = Number((view.config && view.config.voiceRate) || 1.05);
      u.pitch = 1.06;
      u.onstart = () => {
        this.speaking = true;
      };
      u.onend = () => {
        this.speaking = false;
      };
      u.onerror = () => {
        this.speaking = false;
      };
      window.speechSynthesis.speak(u);
      console.info(`[tts] system "${line}" voice=${this.voice ? this.voice.name : 'default'}`);
      return true;
    } catch (err) {
      console.info('[tts] system error', err && err.message);
      return false;
    }
  },

  stop() {
    this.seq += 1;
    this.stopAudio();
    if (this.available()) {
      try {
        window.speechSynthesis.cancel();
      } catch (_) {}
    }
  },
};

if (typeof window.speechSynthesis !== 'undefined') {
  tts.pick();
  window.speechSynthesis.onvoiceschanged = () => tts.pick();
}

/* --------------------------- 实时字幕 --------------------------- */

const LIVE_LABEL = { codex: 'Codex', claude: 'Claude Code', workbuddy: 'WorkBuddy' };
const liveCtl = { active: false, done: false, timer: null, typer: null, shown: 0, target: '', hideTimer: null };

function fmtDur(ms) {
  const sec = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

function liveClock() {
  if (!(liveCtl.active || liveCtl.done)) return;
  // 完成态优先用会话日志里的真实耗时
  if (liveCtl.done && view.liveDuration) {
    el.liveTime.textContent = fmtDur(view.liveDuration);
    return;
  }
  if (!view.liveStartedAt) return;
  el.liveTime.textContent = fmtDur(Date.now() - view.liveStartedAt);
}

function setLiveText(text) {
  liveCtl.target = text || '';
  liveCtl.shown = 0;
  clearInterval(liveCtl.typer);
  liveCtl.typer = null;
  el.liveText.textContent = '';
  if (!liveCtl.target) return;

  const step = Math.max(2, Math.ceil(liveCtl.target.length / 70));
  liveCtl.typer = setInterval(() => {
    liveCtl.shown = Math.min(liveCtl.target.length, liveCtl.shown + step);
    el.liveText.textContent = liveCtl.target.slice(0, liveCtl.shown);
    if (liveCtl.shown >= liveCtl.target.length) {
      clearInterval(liveCtl.typer);
      liveCtl.typer = null;
    }
  }, 26);
}

function openLive() {
  clearTimeout(liveCtl.hideTimer);
  el.live.classList.remove('warn');
  liveCtl.active = true;
  liveCtl.done = false;
  view.liveVisible = true;
  el.live.classList.add('show');
  el.live.classList.remove('done');
  el.liveChip.classList.add('hidden');
  hideBubble();
  if (!liveCtl.timer) liveCtl.timer = setInterval(liveClock, 1000);
  liveClock();
  refreshMood();
}

function closeLive() {
  clearTimeout(liveCtl.hideTimer);
  clearInterval(liveCtl.typer);
  liveCtl.typer = null;
  liveCtl.active = false;
  liveCtl.done = false;
  liveCtl.target = '';
  view.liveDuration = 0;
  view.liveVisible = false;
  el.live.classList.remove('show', 'done');
  el.liveText.textContent = '';
  if (liveCtl.timer) {
    clearInterval(liveCtl.timer);
    liveCtl.timer = null;
  }
  refreshMood(true);
}

function handleLive(payload) {
  if (!payload || !payload.ev) return;
  if (view.config && view.config.showLive === false) return;

  const ev = payload.ev;
  const st = payload.state || {};
  const label = LIVE_LABEL[st.provider] || '会话';

  if (ev.kind === 'idle') {
    closeLive();
    return;
  }

  if (ev.kind === 'start') {
    tts.stop();
    view.liveStartedAt = st.startedAt || Date.now();
    liveCtl.done = false;
    openLive();
    el.liveTitle.textContent = `${label} 开始处理`;
    setLiveText('接到任务了，先看看现场…');
    return;
  }

  if (ev.kind === 'done') {
    view.liveStartedAt = st.startedAt || view.liveStartedAt;
    view.liveDuration = ev.durationMs || 0;
    liveCtl.active = false;
    liveCtl.done = true;
    el.live.classList.add('done');
    el.liveTitle.textContent = `${label} 完成`;
    if (ev.text) setLiveText(ev.text);
    else if (!liveCtl.target) setLiveText('这一轮结束了。');
    liveClock();
    clearTimeout(liveCtl.hideTimer);
    liveCtl.hideTimer = setTimeout(closeLive, 9000);
    if (ev.text) tts.speak(ev.text);
    return;
  }

  // think / say / tool
  if (!liveCtl.active) {
    view.liveStartedAt = st.startedAt || Date.now();
    openLive();
  } else if (st.startedAt && !view.liveStartedAt) {
    view.liveStartedAt = st.startedAt;
  }

  if (ev.kind === 'tool') {
    el.liveChip.textContent = `${ev.label || '动作'}${st.tools > 1 ? ' ×' + st.tools : ''}`;
    el.liveChip.classList.remove('hidden');
    if (!liveCtl.target) {
      el.liveTitle.textContent = `${label} 在动手`;
      if (ev.text) setLiveText(ev.text);
    }
    return;
  }

  if (ev.approval) {
    el.liveTitle.textContent = `${label} 等你审批`;
    el.live.classList.add('warn');
  } else {
    el.liveTitle.textContent = ev.kind === 'think' ? `${label} 整理思路` : `${label} 正在回复`;
    el.live.classList.remove('warn');
  }
  if (ev.text) setLiveText(ev.text);
  if (st.tools) {
    el.liveChip.textContent = `动作 ×${st.tools}`;
    el.liveChip.classList.remove('hidden');
  }
}

/* --------------------------- 养成 --------------------------- */

function renderGrow(g) {
  if (!g) return;
  view.grow = g;

  el.rankName.textContent = g.rank;
  el.rankStars.textContent = '★'.repeat(g.stars);
  el.rankBar.style.width = `${Math.round((g.progress || 0) * 100)}%`;
  el.treatCount.textContent = g.treats;
  el.btnFeed.disabled = g.treats <= 0;
  el.btnFeed.title =
    g.treats > 0
      ? `喂一条小鱼干 · 亲密度 +5（还剩 ${g.treats} 条）`
      : '小鱼干用完了，再多陪我干会儿活';

  if (g.nextRank) {
    el.level.textContent = `${g.rank} · ${g.points}/${g.nextAt}`;
    el.level.title = `距离「${g.nextRank}」还差 ${g.toNext} 点`;
  } else {
    el.level.textContent = `${g.rank} · ${g.points} 点`;
    el.level.title = '亲密度已经拉满了';
  }
  el.petWrap.title = `亲密度 ${g.points} · ${g.rank} ${'★'.repeat(g.stars)} · 小鱼干 ${g.treats}`;
}

async function doInteract(kind) {
  const r = await api.interact(kind);
  if (r && r.grow) renderGrow(r.grow);
  if (!r) return;

  if (r.accepted) {
    anim.play(kind === 'feed' ? 'jumping' : 'waving', { once: true, onEnd: () => refreshMood(true) });
    const text = `+${r.delta} 亲密度 · ${esc(r.reaction)}`;
    if (view.cardOpen) flashMsg(`亲密度 +${r.delta}｜${r.reaction}`, false);
    else say(text);
  } else {
    if (view.cardOpen) flashMsg(r.reaction || '现在不行哦', true);
    else say(esc(r.reaction || '现在不行哦'));
  }

  if (r.levelUp) {
    anim.play('jumping', { once: true, onEnd: () => refreshMood(true) });
    const text = `段位晋到「${esc(r.levelUp.to)}」啦，${'★'.repeat(r.levelUp.stars)}`;
    if (view.cardOpen) flashMsg(text, false);
    else say(text, 6500);
  }
}

/* --------------------------- 情绪 --------------------------- */

function computeMood() {
  const data = view.data;
  if (liveCtl.active) return 'working';
  if (!data) return 'idle';
  if (!data.ok) return 'failed';
  const a = data.activity || {};
  const now = Date.now();
  if (a.lastErrorAt && now - a.lastErrorAt < 120000) return 'failed';
  if (a.lastAt && now - a.lastAt < 45000) return 'working';
  if ((data.unhealthy || []).length) return 'worried';
  if (a.lastAt && now - a.lastAt > 10 * 60000) return 'sleep';
  return 'idle';
}

function trackFor(mood) {
  switch (mood) {
    case 'working':
      return 'running';
    case 'failed':
      return 'failed';
    case 'worried':
    case 'sleep':
      return 'waiting';
    default:
      return 'idle';
  }
}

function refreshMood(force) {
  const mood = computeMood();
  const base = trackFor(mood);
  if (mood !== view.mood) view.lastMoodChange = Date.now();
  view.mood = mood;
  view.base = base;
  if (!view.cardOpen && !anim.once) anim.play(base, { force: force || anim.track !== base });
}

/* --------------------------- 数据 --------------------------- */

function applyState(payload) {
  if (!payload || !payload.state) return;
  const st = payload.state;
  view.data = st;
  if (view.cardOpen && view.cardView === 'bills') renderBills();
  if (payload.grow) renderGrow(payload.grow);
  view.budget = payload.budget || view.budget;
  view.predict = payload.predict || view.predict;
  renderIntake(payload.meta, st.daily);
  if (payload.trip !== undefined) renderTrip(payload.trip);
  renderCard();
  refreshMood();

  for (const ev of payload.events || []) handleEvent(ev);
}

function handleEvent(ev) {
  if (!ev) return;
  if (ev.kind === 'switch') {
    anim.play('jumping', { once: true, onEnd: () => refreshMood(true) });
    say(`已经换到 <strong>${esc(ev.name)}</strong> 了，锅我背！`);
  } else if (ev.kind === 'error') {
    anim.play('failed', { once: true, onEnd: () => refreshMood(true) });
    say('这条通道在漏水…点我看看？');
  } else if (ev.kind === 'levelup') {
    anim.play('jumping', { once: true, onEnd: () => refreshMood(true) });
    say(`升级啦！Lv.${ev.level}，白饭加量～`);
  }
}

/* --------------------------- 交互 --------------------------- */

el.apps.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  const appType = btn.dataset.app;

  if (act === 'toggle') {
    if (view.expanded.has(appType)) view.expanded.delete(appType);
    else view.expanded.add(appType);
    renderCard();
    return;
  }

  if (act === 'switch') {
    if (btn.classList.contains('current')) return;
    btn.disabled = true;
    const res = await api.switchProvider({ appType, id: btn.dataset.id });
    btn.disabled = false;
    if (res && res.ok) {
      anim.play('jumping', { once: true, onEnd: () => refreshMood(true) });
      flashMsg(`已切到「${res.name}」，写入了 ${res.files.join('、')}；建议重启 CC Switch 刷新状态。`, false);
    } else if (res && res.canceled) {
      flashMsg('好，那我不动你的配置。', false);
    } else {
      anim.play('failed', { once: true });
      flashMsg((res && res.message) || '切换失败了…', true);
    }
  }
});

let msgTimer = null;
function flashMsg(text, bad) {
  let box = document.getElementById('card-toast');
  if (!box) {
    box = document.createElement('div');
    box.id = 'card-toast';
    el.card.appendChild(box);
  }
  box.textContent = text;
  box.classList.toggle('bad', !!bad);
  requestAnimationFrame(() => box.classList.add('show'));
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => box.classList.remove('show'), 3000);
}

el.btnClose.addEventListener('click', closeCard);

el.btnProfile.addEventListener('click', () => {
  setCardView(view.cardView === 'profile' ? 'channels' : 'profile');
});

el.btnBills.addEventListener('click', () => {
  setCardView(view.cardView === 'bills' ? 'channels' : 'bills');
});

el.pcClose.addEventListener('click', () => el.postcard.classList.remove('show'));

el.trip.addEventListener('click', () => openCard());
el.btnOpenCC.addEventListener('click', () => api.openCC());
el.btnMore.addEventListener('click', () => api.menu());

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeCard();
});

/* 拖拽 */
let drag = null;
let passThrough = true;

el.petWrap.addEventListener('mousedown', async (e) => {
  if (e.button !== 0) return;
  e.preventDefault();
  const b = await api.getBounds();
  drag = { sx: e.screenX, sy: e.screenY, bx: b.x, by: b.y, moved: false };
  window.addEventListener('mousemove', onDragMove, true);
  window.addEventListener('mouseup', onDragEnd, true);
});

function onDragMove(e) {
  if (!drag) return;
  const dx = e.screenX - drag.sx;
  const dy = e.screenY - drag.sy;
  if (!drag.moved && Math.hypot(dx, dy) > 5) {
    drag.moved = true;
    el.petWrap.classList.add('dragging');
    closeCard();
    anim.play(dx >= 0 ? 'running-right' : 'running-left', { force: true });
  }
  if (drag.moved) api.move({ x: drag.bx + dx, y: drag.by + dy });
}

function onDragEnd() {
  window.removeEventListener('mousemove', onDragMove, true);
  window.removeEventListener('mouseup', onDragEnd, true);
  const wasDrag = drag && drag.moved;
  drag = null;
  el.petWrap.classList.remove('dragging');
  if (wasDrag) {
    api.drop();
    refreshMood(true);
  } else {
    toggleCard();
  }
}

el.petWrap.addEventListener('dblclick', (e) => {
  e.preventDefault();
  doInteract('pet');
});

el.btnFeed.addEventListener('click', (e) => {
  e.stopPropagation();
  doInteract('feed');
});

el.petWrap.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  api.menu();
});

/* 点击穿透：只有落在宠物/卡片上才接收鼠标 */
window.addEventListener(
  'mousemove',
  (e) => {
    const node = document.elementFromPoint(e.clientX, e.clientY);
    const over = !!(node && node.closest('.hit'));
    const wantIgnore = !over;
    if (wantIgnore !== passThrough) {
      passThrough = wantIgnore;
      api.setIgnore(wantIgnore);
    }
  },
  true
);

/* 饿了提醒（20 分钟最多一次） */
let lastHungryNag = 0;
setInterval(() => {
  const m = view.meta;
  if (!m || view.cardOpen || drag) return;
  if (m.state !== 'hungry') return;
  if (Date.now() - lastHungryNag < 20 * 60 * 1000) return;
  lastHungryNag = Date.now();
  say(pick(['饿了…今天还没怎么烧 token。', '肚子空空的，跑个任务喂我嘛。']), 6000);
}, 60000);

/* 自动碎碎念 */
setInterval(() => {
  if (view.cardOpen || drag) return;
  if (!view.config || !view.config.showBubble) return;
  if (Date.now() - view.lastSay < 80000) return;
  const pool = skinLines(view.mood);
  say(pick(pool));
}, 26000);

/* --------------------------- 启动 --------------------------- */

async function boot() {
  anim.applyScale(0.72);

  const payload = await api.init();
  if (payload && payload.config) {
    view.config = payload.config;
    view.skins = payload.skins || [];
    view.scale = payload.config.scale || 0.72;
    if (payload.skin) applySkin(payload.skin);
    anim.applyScale(payload.config.scale || 0.72);
  }
  if (payload && payload.state) applyState({ state: payload.state, events: [] });

  api.onState((p) => applyState(p));
  api.onConfig((c) => {
    view.config = c;
    if (c.scale && c.scale !== view.scale) anim.applyScale(c.scale);
    if (!c.showBubble) hideBubble();
  });

  api.onSkin((skin) => {
    if (!skin) return;
    applySkin(skin);
    say(`换成「${esc(skin.name)}」啦～`, 4200);
  });
  api.onCommand((cmd) => {
    if (cmd === 'toggle-card') toggleCard();
    else if (cmd === 'feed') doInteract('feed');
    else if (cmd === 'view-profile') setCardView('profile');
    else if (cmd === 'view-bills') setCardView('bills');
    else if (cmd === 'reply-last') openReply();
    else if (cmd === 'trip:recall') api.tripRecall().then((r) => r && r.ok && showPostcard({ report: r.report, item: r.item }));
    else if (cmd.startsWith('trip:')) api.tripStart(cmd.slice(5)).then((r) => { if (r && r.ok) renderTrip(r.trip); });
  });

  api.onGrow((g) => renderGrow(g));

  api.onTrip((p) => renderTrip(p && p.trip));

  api.onPostcard((p) => {
    showPostcard(p);
    api.getProfile().then(renderProfile);
  });

  api.onDish((d) => {
    if (!d) return;
    anim.play('jumping', { once: true, onEnd: () => refreshMood(true) });
    say(`🍽 新菜上桌：${d.emoji} ${esc(d.name)}（${esc(d.model)}）`, 7000);
    api.getProfile().then(renderProfile);
  });

  api.onAchievement((a) => {
    achQueue.push(a);
    setTimeout(flushAchievements, 250);
  });

  api.onBudget((p) => {
    say(`今天已经 ${p.bowls} 碗，超预算 ${p.limit} 碗了…照这速度全天约 ${p.projected} 碗。`, 8000);
  });

  api.onRest((p) => {
    say(`坐了 ${p.minutes} 分钟啦，起来走两步，顺便给我加点水。`, 8000);
  });

  api.onMeta((p) => {
    if (!p) return;
    if (p.meta) renderIntake(p.meta);
    if (p.daily) {
      say(`昨天吃了 ${p.daily.bowls.toLocaleString('zh-CN')} 碗白饭（${fmtTokens(p.daily.tokens)} tokens）。`, 7000);
      return;
    }
    if (p.feed) {
      anim.play('jumping', { once: true, onEnd: () => refreshMood(true) });
      const text = p.feed.bigMeal
        ? `🍚 一口吞了 ${p.feed.bowls.toLocaleString('zh-CN')} 碗（${fmtTokens(p.feed.tokens)} tokens）…有点撑。`
        : `🍚 +${p.feed.bowls} 碗（${fmtTokens(p.feed.tokens)} tokens）`;
      if (view.cardOpen) flashMsg(text, false);
      else say(text, 6000);
    }
  });

  api.onLive((p) => handleLive(p));

  api.onApproval((p) => {
    anim.play('jumping', { once: true, onEnd: () => refreshMood(true) });
    say(`WorkBuddy 在等你审批：${esc((p && p.text) || '一个批量删除')}`, 9000);
  });

  if (payload && payload.live && payload.live.active) {
    view.liveStartedAt = payload.live.startedAt || Date.now();
    openLive();
    el.liveTitle.textContent = `${LIVE_LABEL[payload.live.provider] || '会话'} 正在处理`;
    setLiveText('接着上一轮的进度…');
  }

  api.onLevelUp((p) => {
    anim.play('jumping', { once: true, onEnd: () => refreshMood(true) });
    say(`段位晋到「${esc(p.to)}」啦，${'★'.repeat(p.stars || 1)}`, 6500);
  });

  api.onGrowGain((p) => {
    if (p && p.treats > 0) say(`攒够 ${p.treats} 条小鱼干，喂我呀～`);
  });

  if (payload && payload.grow) renderGrow(payload.grow);
  if (payload) renderIntake(payload.meta, payload.state && payload.state.daily);
  if (payload && payload.budget) view.budget = payload.budget;
  if (payload && payload.trip) renderTrip(payload.trip);
  if (payload && payload.profile) renderProfile(payload.profile);

  setTimeout(() => say('我上线啦，正在盯着 cc-switch。'), 900);
}

boot();
