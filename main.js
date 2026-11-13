'use strict';

const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, shell, dialog, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');

function logError(tag, err) {
  try {
    const dir = app.getPath('userData');
    require('fs').appendFileSync(
      require('path').join(dir, 'error.log'),
      `[${tag}] ${new Date().toISOString()} ${(err && err.stack) || err}\n`
    );
  } catch (_) {}
}

process.on('unhandledRejection', (err) => logError('reject', err));

process.on('uncaughtException', (err) => logError('uncaught', err));

const store = require('./src/store');
const cc = require('./src/ccswitch');
const petstate = require('./src/petstate');
const growstore = require('./src/growstore');
const { LiveFeed } = require('./src/livefeed');
const gameplay = require('./src/gameplay');
const reply = require('./src/reply');
const { WbFeed } = require('./src/wbfeed');
const wbchat = require('./src/wbchat');
const skins = require('./src/skins');
const voice = require('./src/voice');

const W = 320;
const H = 470;
const POLL_MS = 2500;

let win = null;
let tray = null;
let cfg = null;
let grow = null;
let liveFeed = null;
let wbChat = null;
let liveState = { active: false, provider: null, startedAt: 0, lastAt: 0, tools: 0 };
let liveWatch = null;
let windowReady = false;
let injecting = false;
let lastReply = '';
let lastReplyAt = 0;
let replyChild = null;
let replyWin = null;
let wbFeed = null;
let prevState = null;
let pollTimer = null;
let movingTimer = null;
let pendingBounds = null;

const wantsShortcut = process.argv.includes('--make-shortcut');
// WHALE_ALLOW_MULTI 只给调试用：绕过单实例锁，方便截图/联调
const allowMulti = process.env.WHALE_ALLOW_MULTI === '1';
const gotLock = wantsShortcut || allowMulti || app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => revealWindow());
  app.whenReady().then(() => {
    if (wantsShortcut) {
      const r = createDesktopShortcut();
      console.log('shortcut:', JSON.stringify(r));
      setTimeout(() => app.quit(), 300);
      return;
    }
    boot();
  });
}

function boot() {
  cfg = store.init();
  grow = growstore.init();
  voice.init(path.join(app.getPath('userData'), 'voice-cache'));
  createWindow();
  createTray();
  startPolling();
  startLiveFeed();
  startWbFeed();

  app.on('activate', () => revealWindow());
  app.on('window-all-closed', (e) => e.preventDefault());
}

/* ----------------------------- 窗口 ----------------------------- */

function defaultPosition() {
  const area = screen.getPrimaryDisplay().workArea;
  return { x: area.x + area.width - W - 24, y: area.y + area.height - H - 12 };
}

function createWindow() {
  const pos = cfg.x == null ? defaultPosition() : { x: cfg.x, y: cfg.y };

  win = new BrowserWindow({
    width: W,
    height: H,
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: true,
    skipTaskbar: true,
    alwaysOnTop: cfg.alwaysOnTop,
    hasShadow: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    roundedCorners: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  win.setMenuBarVisibility(false);
  win.setAlwaysOnTop(cfg.alwaysOnTop, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  win.once('ready-to-show', () => {
    windowReady = true;
    win.showInactive();
    clampIntoWorkArea();
    win.webContents.send('whale:config', cfg);
  });

  win.webContents.once('did-finish-load', () => {
    const wantsCard = process.argv.includes('--open-card') || process.argv.includes('--feed');
    if (wantsCard) {
      setTimeout(() => win && win.webContents.send('whale:cmd', 'toggle-card'), 1600);
    }
    if (process.argv.includes('--feed')) {
      setTimeout(() => win && win.webContents.send('whale:cmd', 'feed'), 2600);
    }
    if (process.argv.includes('--reply-window')) {
      setTimeout(() => createReplyWindow(), 1600);
    }
    if (process.argv.includes('--compose')) {
      setTimeout(() => win && win.webContents.send('whale:cmd', 'compose'), 1600);
    }
    if (process.argv.includes('--reply')) {
      setTimeout(() => win && win.webContents.send('whale:cmd', 'reply-last'), 1600);
    }
    if (process.argv.includes('--dump')) {
      setTimeout(async () => {
        try {
          const js = `JSON.stringify(['#card','#bills','.bill-cache','#bc-hit','.bs-list','#profile','#apps'].map(s=>{const e=document.querySelector(s);if(!e)return [s,'MISSING'];const r=e.getBoundingClientRect();const c=getComputedStyle(e);return [s,Math.round(r.top),Math.round(r.height),c.display,c.opacity,(e.textContent||'').trim().slice(0,24)]}))`;
          const out = await win.webContents.executeJavaScript(js);
          fs.writeFileSync(path.join(app.getPath('userData'), 'layout.json'), out);
          if (process.argv.includes('--profile')) {
            await win.webContents.executeJavaScript("(()=>{const p=document.getElementById('profile');if(p)p.scrollTop=p.scrollHeight;return 1})()");
            await new Promise((r) => setTimeout(r, 400));
          }
          const img = await win.webContents.capturePage();
          fs.writeFileSync(path.join(process.env.WHALE_SHOT_DIR || app.getPath('userData'), 'window.png'), img.toPNG());
          if (replyWin && !replyWin.isDestroyed()) {
            if (process.argv.includes('--reply-tail')) {
              await replyWin.webContents.executeJavaScript(
                "(()=>{const box=document.getElementById('sessions');const rows=box.querySelectorAll('.sess');if(rows.length){rows[rows.length-1].click();box.scrollTop=box.scrollHeight;}return rows.length})()"
              );
              await new Promise((r) => setTimeout(r, 500));
            }
            const rimg = await replyWin.webContents.capturePage();
            fs.writeFileSync(path.join(process.env.WHALE_SHOT_DIR || app.getPath('userData'), 'window-reply.png'), rimg.toPNG());
          }
        } catch (err) {
          fs.writeFileSync(path.join(app.getPath('userData'), 'layout.json'), 'ERR ' + err.message);
        }
      }, 6500);
    }
    if (process.argv.includes('--bills')) {
      setTimeout(() => win && win.webContents.send('whale:cmd', 'toggle-card'), 1500);
      setTimeout(() => win && win.webContents.send('whale:cmd', 'view-bills'), 2200);
    }
    if (process.argv.includes('--profile')) {
      setTimeout(() => win && win.webContents.send('whale:cmd', 'toggle-card'), 1600);
      setTimeout(() => win && win.webContents.send('whale:cmd', 'view-profile'), 2200);
    }
    if (process.argv.includes('--trip')) {
      setTimeout(() => win && win.webContents.send('whale:cmd', 'trip:trench'), 1600);
    }
    if (process.argv.includes('--postcard')) {
      setTimeout(() => startTravel('trench'), 1200);
      setTimeout(() => finishTravel(false), 2400);
    }
  });

  win.on('moved', () => {
    if (!win) return;
    const [x, y] = win.getPosition();
    clearTimeout(movingTimer);
    movingTimer = setTimeout(() => store.set({ x, y }), 400);
  });

  win.on('closed', () => {
    win = null;
  });
}

/**
 * 移动窗口。
 * 必须用 setBounds 而不是 setPosition：透明无边框窗口在 Windows 上每次位移都会
 * 触发一次 1px 的尺寸漂移（setPosition 只改位置，漂移会累积），
 * 之前的表现就是拖动时状态卡一路变长。
 */
function placeWindow(x, y) {
  if (!win || win.isDestroyed()) return;
  win.setBounds({ x: Math.round(x), y: Math.round(y), width: W, height: H });
}

function clampIntoWorkArea() {
  if (!win) return;
  const [x, y] = win.getPosition();
  const disp = screen.getDisplayNearestPoint({ x: x + W / 2, y: y + H / 2 });
  const a = disp.workArea;
  const nx = Math.min(Math.max(x, a.x - 40), a.x + a.width - W + 40);
  const ny = Math.min(Math.max(y, a.y - 20), a.y + a.height - H + 20);
  if (nx !== x || ny !== y) placeWindow(nx, ny);
}

function revealWindow() {
  if (!win) {
    createWindow();
    return;
  }
  win.showInactive();
  win.setAlwaysOnTop(cfg.alwaysOnTop, 'screen-saver');
}

function toggleWindow() {
  if (!win) return createWindow();
  if (win.isVisible()) win.hide();
  else revealWindow();
}

/* ----------------------------- 托盘 ----------------------------- */

function trayImage() {
  const p = path.join(__dirname, 'assets', 'tray.png');
  const img = nativeImage.createFromPath(p);
  return img.isEmpty() ? nativeImage.createEmpty() : img.resize({ width: 20, height: 20 });
}

function createTray() {
  tray = new Tray(trayImage());
  tray.setToolTip('鲸鱼娘 · cc-switch 桌面宠物');
  tray.on('click', toggleWindow);
  refreshTrayMenu();
}

function skinMenuItems() {
  const { skins: all } = skins.list();
  return all.map((s) => ({
    label: s.name,
    type: 'radio',
    checked: (cfg.skin || 'whale') === s.id,
    click: () => applyConfig({ skin: s.id }),
  }));
}

function gameplayMenuItems() {
  return [
    {
      label: grow && grow.trip ? `旅行中：${gameplay.destinationById(grow.trip.destId).name}` : '带她去旅行',
      submenu: [
        ...gameplay.DESTINATIONS.map((d) => ({
          label: `${d.emoji} ${d.name}（${d.minutes} 分钟）`,
          enabled: !grow.trip,
          click: () => win && win.webContents.send('whale:cmd', `trip:${d.id}`),
        })),
        { type: 'separator' },
        { label: '提前召回（带回纪念品）', enabled: !!(grow && grow.trip), click: () => win && win.webContents.send('whale:cmd', 'trip:recall') },
      ],
    },
    {
      label: '每日饭量预算',
      submenu: gameplay.BUDGET_PRESETS.map((v) => ({
        label: v ? `${v} 碗` : '不限',
        type: 'radio',
        checked: (cfg.dailyBowls || 0) === v,
        click: () => applyConfig({ dailyBowls: v }),
      })),
    },
    {
      label: '久坐提醒（90 分钟）',
      type: 'checkbox',
      checked: cfg.restRemind !== false,
      click: (item) => applyConfig({ restRemind: item.checked }),
    },
  ];
}

function refreshTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '鲸鱼娘', enabled: false },
      { type: 'separator' },
      { label: win && win.isVisible() ? '隐藏宠物' : '显示宠物', click: toggleWindow },
      { label: '打开 CC Switch', click: openCCSwitch },
      { type: 'separator' },
      {
        label: '窗口置顶',
        type: 'checkbox',
        checked: !!cfg.alwaysOnTop,
        click: (item) => applyConfig({ alwaysOnTop: item.checked }),
      },
      {
        label: '开机自启',
        type: 'checkbox',
        checked: !!cfg.autoLaunch,
        click: (item) => applyConfig({ autoLaunch: item.checked }),
      },
      { label: '回复当前任务…', click: () => createReplyWindow() },
      { label: '查看最近回复', click: () => win && win.webContents.send('whale:cmd', 'reply-last') },
      {
        label: 'WorkBuddy 活动（只读）',
        type: 'checkbox',
        checked: cfg.showWorkbuddy !== false,
        click: (item) => applyConfig({ showWorkbuddy: item.checked }),
      },
      {
        label: '语音播报结论',
        type: 'checkbox',
        checked: cfg.voice !== false,
        click: (item) => applyConfig({ voice: item.checked }),
      },
      {
        label: '语音音色',
        submenu: [
          ...voice.list().map((v) => ({
            label: `${v.name} · ${v.desc}`,
            type: 'radio',
            checked: (cfg.voiceEngine || 'edge') === 'edge' && (cfg.voiceName || 'zh-CN-XiaoxiaoNeural') === v.id,
            click: () => applyConfig({ voiceEngine: 'edge', voiceName: v.id }),
          })),
          { type: 'separator' },
          {
            label: '系统语音（离线备用）',
            type: 'radio',
            checked: cfg.voiceEngine === 'system',
            click: () => applyConfig({ voiceEngine: 'system' }),
          },
        ],
      },
      {
        label: '语速',
        submenu: [
          { label: '慢', type: 'radio', checked: Number(cfg.voiceRate) === 0.9, click: () => applyConfig({ voiceRate: 0.9 }) },
          { label: '正常', type: 'radio', checked: Number(cfg.voiceRate) === 1.05, click: () => applyConfig({ voiceRate: 1.05 }) },
          { label: '快', type: 'radio', checked: Number(cfg.voiceRate) === 1.25, click: () => applyConfig({ voiceRate: 1.25 }) },
        ],
      },
      {
        label: '实时字幕（跟随 Codex / Claude 会话）',
        type: 'checkbox',
        checked: cfg.showLive !== false,
        click: (item) => applyConfig({ showLive: item.checked }),
      },
      {
        label: '允许宠物切换供应商',
        type: 'checkbox',
        checked: !!cfg.allowSwitch,
        click: (item) => applyConfig({ allowSwitch: item.checked }),
      },
      { label: '皮肤', submenu: skinMenuItems() },
      {
        label: '大小',
        submenu: [
          { label: '小', type: 'radio', checked: cfg.scale === 0.56, click: () => applyConfig({ scale: 0.56 }) },
          { label: '中', type: 'radio', checked: cfg.scale === 0.72, click: () => applyConfig({ scale: 0.72 }) },
          { label: '大', type: 'radio', checked: cfg.scale === 0.9, click: () => applyConfig({ scale: 0.9 }) },
        ],
      },
      ...gameplayMenuItems(),
      { type: 'separator' },
      { label: '重新读取 cc-switch 数据', click: () => poll(true) },
      { label: '创建桌面快捷方式', click: () => showShortcutResult(createDesktopShortcut()) },
      { label: '打开配置文件目录', click: () => shell.openPath(app.getPath('userData')) },
      { type: 'separator' },
      { label: '退出', click: () => app.quit() },
    ])
  );
}

/* ----------------------------- 状态轮询 ----------------------------- */

function computeEvents(state) {
  const events = [];
  if (!state || !state.ok) return events;

  if (prevState && prevState.ok) {
    for (const app of state.apps) {
      const prev = prevState.apps.find((a) => a.appType === app.appType);
      const prevId = prev && prev.current ? prev.current.id : null;
      const nowId = app.current ? app.current.id : null;
      if (nowId && prevId && nowId !== prevId) {
        events.push({ kind: 'switch', appType: app.appType, name: app.current.name, label: app.label });
      }
    }
    const pe = prevState.activity.lastErrorAt || 0;
    const ne = state.activity.lastErrorAt || 0;
    if (ne > pe) events.push({ kind: 'error', message: state.activity.lastError || '请求失败' });

    if (state.stats.level > (prevState.stats.level || 1)) {
      events.push({ kind: 'levelup', level: state.stats.level });
    }
  }
  return events;
}

async function poll(force) {
  let state;
  try {
    state = cc.readState();
  } catch (err) {
    state = { ok: false, reason: 'exception', message: String(err.message || err), apps: [], providers: [], unhealthy: [], stats: {}, activity: {} };
  }

  if (state && state.ok) syncGrow(state);
  if (state && state.ok) syncMeta(state);
  if (state && state.ok) tickTrip();
  if (state && state.ok) tickRest();
  if (state && state.ok) tickMenu(state);
  if (state && state.ok) checkAchievements();

  const events = computeEvents(state);
  const changed = force || !prevState || JSON.stringify(strip(state)) !== JSON.stringify(strip(prevState));

  if (changed && win && !win.isDestroyed()) {
    win.webContents.send('whale:state', {
      state,
      events,
      allowSwitch: !!cfg.allowSwitch,
      grow: petstate.view(grow),
      meta: petstate.metaView(grow.meta),
      trip: viewTrip(),
      budget: gameplay.budgetView(grow.meta || {}, cfg.dailyBowls || 0),
      predict: gameplay.predictDay(grow.meta || {}, Date.now()),
    });
  }
  prevState = state;
}

/** 去掉每次都会变的字段，避免无意义重渲染 */
function strip(s) {
  if (!s) return s;
  const { updatedAt, ...rest } = s;
  return rest;
}

/* ----------------------------- WorkBuddy 活动 ----------------------------- */

function startWbFeed() {
  if (wbFeed) return;
  wbFeed = new WbFeed((ev) => handleWbEvent(ev));
  wbFeed.start();
}

function handleWbEvent(ev) {
  if (!cfg || cfg.showWorkbuddy === false) return;
  if (!windowReady) return;

  if (ev.kind === 'tool') {
    handleLiveEvent({ kind: 'tool', provider: 'workbuddy', label: ev.label, text: ev.text, ts: Date.now() });
    return;
  }
  if (ev.kind === 'approval') {
    handleLiveEvent({ kind: 'start', provider: 'workbuddy', ts: Date.now() });
    handleLiveEvent({ kind: 'say', provider: 'workbuddy', approval: true, text: `☑ 等你审批：${ev.text}`, ts: Date.now() });
    if (win && !win.isDestroyed()) win.webContents.send('whale:approval', { text: ev.text });
    return;
  }
  if (ev.kind === 'approval-done') {
    handleLiveEvent({ kind: 'say', provider: 'workbuddy', text: `${ev.label}：${ev.text}`, ts: Date.now() });
  }
}

/* ----------------------------- 实时字幕 ----------------------------- */

function startLiveFeed() {
  if (liveFeed) return;
  liveFeed = new LiveFeed((ev) => {
    if (injecting) return; // 自己注入的回合由 reply 事件驱动，避免重复
    handleLiveEvent(ev);
  });
  liveFeed.start();

  // WorkBuddy 的完整会话也在本地（~/.workbuddy/projects），tail 它拿到真正的对话
  if (!wbChat) {
    wbChat = new wbchat.WbChat((ev) => {
      if (injecting) return;
      handleLiveEvent(ev);
    });
    wbChat.start();
  }

  // 长时间没事件就当作结束，避免面板一直挂着
  liveWatch = setInterval(() => {
    if (!liveState.active) return;
    if (Date.now() - liveState.lastAt < 120000) return;
    liveState = { ...liveState, active: false };
    pushLive({ kind: 'idle' });
  }, 5000);
}

function handleLiveEvent(ev) {
  if (!cfg || !cfg.showLive) return;
  const now = Date.now();

  if (ev.kind === 'done' && ev.text) {
    lastReply = ev.text;
    lastReplyAt = now;
  } else if (ev.kind === 'say' && ev.text && ev.text.length > lastReply.length * 0.6) {
    // 旁白比上一条结论还长时也记一下，方便查看
    if (ev.text.length > 80) {
      lastReply = ev.text;
      lastReplyAt = now;
    }
  }

  if (ev.kind === 'done') {
    liveState = { ...liveState, active: false, lastAt: now };
  } else {
    const isStart = ev.kind === 'start';
    const startedAt = isStart && ev.ts && Math.abs(now - ev.ts) < 300000 ? ev.ts : liveState.startedAt || now;
    liveState = {
      active: true,
      provider: ev.provider || liveState.provider,
      startedAt: isStart ? startedAt : startedAt,
      lastAt: now,
      tools: isStart ? 0 : liveState.tools + (ev.kind === 'tool' ? 1 : 0),
    };
  }
  pushLive(ev);
}

function pushLive(ev) {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('whale:live', {
    ev,
    state: {
      active: liveState.active,
      provider: liveState.provider,
      startedAt: liveState.startedAt,
      tools: liveState.tools,
    },
  });
}

/* ----------------------------- 回复 Codex ----------------------------- */

function createReplyWindow() {
  if (replyWin && !replyWin.isDestroyed()) {
    replyWin.show();
    replyWin.focus();
    return replyWin;
  }

  const cursor = screen.getCursorScreenPoint();
  const area = screen.getDisplayNearestPoint(cursor).workArea;
  const W = 480;
  const H = 560;

  replyWin = new BrowserWindow({
    width: W,
    height: H,
    x: Math.round(area.x + (area.width - W) / 2),
    y: Math.round(area.y + (area.height - H) / 2),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    roundedCorners: true,
    title: '回复 Codex',
    webPreferences: {
      preload: path.join(__dirname, 'preload-reply.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  replyWin.setMenuBarVisibility(false);
  replyWin.loadFile(path.join(__dirname, 'renderer', 'reply.html'));
  replyWin.once('ready-to-show', () => {
    if (!replyWin) return;
    replyWin.show();
    replyWin.focus();
  });
  replyWin.on('closed', () => {
    replyWin = null;
  });
  return replyWin;
}

async function sendReply(text, sessionId) {
  const prompt = String(text || '').trim();
  if (!prompt) return { ok: false, message: '内容空着' };
  if (injecting) return { ok: false, message: '上一条还在跑' };
  if (replyChild) return { ok: false, message: '上一条还在跑' };

  if (!cfg.allowReply) {
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: ['先不用', '允许并发送'],
      defaultId: 1,
      cancelId: 0,
      title: '让鲸鱼娘替你回复 Codex？',
      message: '会在后台用 codex exec 续写最近一次会话。',
      detail:
        '这会消耗 token，并且 Codex 可能在该会话里执行工具调用（沙箱策略沿用你的 config.toml）。\n\n' +
        '如果那个会话正在别的窗口里跑，建议等它停下来再发，避免两边同时写同一个会话。',
    });
    if (response !== 1) return { ok: false, canceled: true };
    applyConfig({ allowReply: true });
  }

  const session = sessionId ? reply.findSessionById(sessionId) : reply.findLatestSession();
  if (!session) return { ok: false, message: '没找到可续写的 Codex 会话' };

  injecting = true;
  const started = Date.now();
  // 万一 codex 卡住不退出（等输入、网络挂起），别让「上一条还在跑」永远锁死
  const watchdog = setTimeout(() => {
    injecting = false;
    replyChild = null;
  }, 15 * 60 * 1000);

  handleLiveEvent({ kind: 'start', provider: 'codex', ts: started });

  const started2 = reply.startReply(prompt, (ev) => {
    if (ev.type === 'message') {
      lastReply = ev.text;
      lastReplyAt = Date.now();
      handleLiveEvent({ kind: 'say', provider: 'codex', text: ev.text, ts: Date.now() });
    } else if (ev.type === 'done') {
      handleLiveEvent({ kind: 'done', provider: 'codex', text: lastReply, durationMs: Date.now() - started, ts: Date.now() });
    } else if (ev.type === 'error') {
      handleLiveEvent({ kind: 'done', provider: 'codex', text: '❌ ' + (ev.text || '执行失败'), durationMs: Date.now() - started, ts: Date.now() });
    } else if (ev.type === 'exit') {
      clearTimeout(watchdog);
      injecting = false;
      replyChild = null;
    }
  }, { session });

  if (!started2) {
    clearTimeout(watchdog);
    injecting = false;
    return { ok: false, message: '启动 codex 失败' };
  }
  replyChild = started2.child;
  return {
    ok: true,
    sessionId: session.id,
    title: session.title,
    project: session.project,
    cwd: session.cwd,
    idleMs: session.idleMs,
  };
}

function replyStatus() {
  const s = reply.findLatestSession();
  let text = lastReply;
  let at = lastReplyAt;
  if (!text && s) {
    const fromLog = reply.findLatestReply(s.path);
    if (fromLog) {
      text = fromLog.text;
      at = fromLog.at;
    }
  }
  const label = s ? cc.sessionLabel(s.id) : null;
  return {
    sessionTitle: label ? label.title : '',
    sessionProject: label ? label.project : '',
    lastReply: text,
    lastReplyAt: at,
    sessionId: s ? s.id : null,
    cwd: s ? s.cwd : null,
    idleMs: s ? s.idleMs : null,
    injecting,
    allowReply: !!cfg.allowReply,
  };
}

/* ----------------------------- 养成 ----------------------------- */

function pushGrow() {
  if (win && !win.isDestroyed()) win.webContents.send('whale:grow', petstate.view(grow));
}

/**
 * 把 cc-switch 的请求量折算成「回合」，补发亲密度并结算小鱼干。
 * 首次运行只对齐水位线，不补发历史点数（否则一开箱就满级）。
 */
function syncGrow(state) {
  const total = (state.stats && state.stats.totalRequests) || 0;
  let next = grow;

  if (!next.bootstrapped) {
    const turns = Math.floor(total / petstate.AFFINITY_CFG.requestsPerTurn);
    next = {
      ...next,
      bootstrapped: true,
      seenRequests: total,
      affinity: { ...next.affinity, turns },
      ledger: { ...next.ledger, turnsAtLastTreatGrant: turns, lastTreatGrantAt: Date.now() },
    };
    grow = growstore.save(next);
    pushGrow();
    return;
  }

  const before = petstate.rankOf(next.affinity.points);

  const aw = petstate.awardTurns(next, total);
  next = aw.state;

  const settled = petstate.settleTreats(next);
  next = { ...settled.state, seenRequests: total };

  const changed = aw.gained > 0 || settled.gained > 0 || next.seenRequests !== grow.seenRequests;
  if (changed) {
    grow = growstore.save(next);
    pushGrow();
    if (settled.gained > 0 && win && !win.isDestroyed()) {
      win.webContents.send('whale:grow-gain', { treats: settled.gained, points: aw.gained });
    }
  } else {
    grow = next;
  }

  const after = petstate.rankOf(grow.affinity.points);
  if (after.name !== before.name && win && !win.isDestroyed()) {
    win.webContents.send('whale:levelup', { from: before.name, to: after.name, stars: after.stars });
  }
}

/**
 * 把 token 消耗当饭吃：今日 token 增量 → 饱食度；时间流逝 → 自然消化。
 * 首次运行 / 跨天只对齐水位线，不补吃历史。
 */
function syncMeta(state) {
  // 窗口还没起来就先不进食，等下一轮把这次增量一起吃掉（否则气泡会丢）
  if (!windowReady) return;
  const now = Date.now();
  const today = (state.stats && state.stats.tokens) || 0;

  if (!grow.meta) grow = { ...grow, meta: petstate.emptyMeta(now) };

  let next = { ...grow };
  let changed = false;

  const decayed = petstate.decayMeta(next.meta, now);
  if (decayed.lost > 0) {
    next.meta = decayed.meta;
    changed = true;
  }

  const rolled = petstate.rollDay(next.meta, now, today);
  if (rolled.rolled) {
    next.meta = rolled.meta;
    next.budgetNotified = false;
    changed = true;
    // 跨天时把昨天的成绩播报一下
    const prev = grow.meta.fedToday || 0;
    if (prev > 0 && win && !win.isDestroyed()) {
      win.webContents.send('whale:meta', {
        daily: { bowls: Math.round(prev / petstate.META_CFG.bowlTokens), tokens: prev },
        meta: petstate.metaView(next.meta),
      });
    }
  }

  if (!next.meta.tokensSeen && today) {
    // 首次运行：账面对齐今天的真实饭量，但饱食度保持初始值（不白吃一顿）
    next.meta = {
      ...next.meta,
      tokensSeen: today,
      fedToday: today,
      bowlsToday: today / petstate.META_CFG.bowlTokens,
    };
    changed = true;
  }

  const delta = today - next.meta.tokensSeen;
  let feed = null;

  if (delta > 0) {
    const capped = Math.min(delta, petstate.META_CFG.capPerPoll);
    const r = petstate.feedMeta(next.meta, capped, now);
    next.meta = { ...r.meta, tokensSeen: today };

    // 终身饭量 + 活跃日
    const ex = { ...(next.extras || {}) };
    ex.lifetimeTokens = (ex.lifetimeTokens || 0) + capped;
    const dayKey = petstate.dayKeyOf(now);
    const days = Array.isArray(ex.days) ? ex.days.slice() : [];
    if (!days.includes(dayKey)) days.push(dayKey);
    ex.days = days.slice(-90);
    next.extras = ex;

    changed = true;
    feed = {
      tokens: capped,
      bowls: Math.max(1, Math.round(capped / petstate.META_CFG.bowlTokens)),
      satiety: Math.round(r.meta.satiety),
      overflow: r.overflow,
      bigMeal: capped >= petstate.META_CFG.bigMealTokens,
    };
  } else if (delta < 0) {
    // 跨天或数据校正：只对齐水位线，不吐出来
    next.meta = { ...next.meta, tokensSeen: today };
    changed = true;
  }

  grow = changed ? growstore.save(next) : { ...grow, meta: next.meta };

  if (feed && win && !win.isDestroyed()) {
    win.webContents.send('whale:meta', { feed, meta: petstate.metaView(grow.meta) });
  }

  // 预算超支：一天只提醒一次
  const limit = cfg.dailyBowls || 0;
  if (limit > 0 && grow.meta.bowlsToday > limit && !grow.budgetNotified) {
    grow = growstore.save({ ...grow, budgetNotified: true });
    if (win && !win.isDestroyed()) {
      win.webContents.send('whale:budget', {
        bowls: Math.round(grow.meta.bowlsToday),
        limit,
        projected: Math.round(gameplay.predictDay(grow.meta).projectedBowls),
      });
    }
  }
}

/* ----------------------------- 成就 / 旅行 / 休息 ----------------------------- */

function achCtx() {
  const now = Date.now();
  const m = grow.meta || {};
  const e = grow.extras || {};
  const hour = new Date(now).getHours();
  return {
    pets: grow.affinity.pets || 0,
    feeds: grow.affinity.feeds || 0,
    treats: grow.ledger.treats || 0,
    points: grow.affinity.points || 0,
    lifetimeTokens: e.lifetimeTokens || 0,
    todayTokens: m.fedToday || 0,
    bigMeals: m.bigMeals || 0,
    trips: e.trips || 0,
    switches: e.switches || 0,
    collection: e.collection || [],
    days: e.days || [],
    streak: gameplay.streakOf(e.days || [], now),
    nightOwl: hour >= 0 && hour < 5 && (m.fedToday || 0) > 0,
    unlocked: e.achievements || {},
    nowMs: now,
  };
}

function checkAchievements() {
  if (!windowReady) return [];
  const newly = gameplay.evaluate(achCtx());
  if (!newly.length) return [];
  const e = { ...(grow.extras || {}) };
  e.achievements = { ...(e.achievements || {}) };
  for (const a of newly) e.achievements[a.id] = Date.now();
  grow = growstore.save({ ...grow, extras: e });
  if (win && !win.isDestroyed()) {
    for (const a of newly) win.webContents.send('whale:achievement', a);
  }
  return newly;
}

function profileView() {
  const e = grow.extras || {};
  const unlocked = e.achievements || {};
  const dishes = Object.entries(e.dishes || {})
    .map(([model, d]) => ({ model, ...d }))
    .sort((a, b) => (b.firstAt || 0) - (a.firstAt || 0));
  return {
    dishes,
    dishCount: dishes.length,
    achievements: gameplay.achievementView(unlocked),
    unlockedCount: Object.keys(unlocked).length,
    total: gameplay.ACHIEVEMENTS.length,
    collection: e.collection || [],
    stats: {
      lifetimeTokens: e.lifetimeTokens || 0,
      trips: e.trips || 0,
      switches: e.switches || 0,
      activeDays: (e.days || []).length,
      streak: gameplay.streakOf(e.days || [], Date.now()),
    },
  };
}

function viewTrip() {
  const t = grow.trip;
  if (!t) return null;
  const dest = gameplay.destinationById(t.destId);
  return {
    destId: t.destId,
    name: dest.name,
    emoji: dest.emoji,
    startedAt: t.startedAt,
    endsAt: t.endsAt,
    remainMs: gameplay.travelRemainMs(t, Date.now()),
  };
}

function pushTrip() {
  if (win && !win.isDestroyed()) win.webContents.send('whale:trip', { trip: viewTrip() });
}

function startTravel(destId) {
  if (grow.trip) return { ok: false, message: '她还在外面呢' };
  const dest = gameplay.destinationById(destId);
  const meta = grow.meta || {};
  const trip = gameplay.startTrip(dest, { tokensAtStart: meta.fedToday || 0, bowlsAtStart: meta.bowlsToday || 0 });
  grow = growstore.save({ ...grow, trip });
  pushTrip();
  return { ok: true, trip: viewTrip() };
}

function finishTravel(early) {
  if (!grow.trip) return { ok: false, message: '她没在旅行' };
  const now = Date.now();
  const meta = grow.meta || {};
  const res = gameplay.finishTrip(grow.trip, meta, meta.fedToday || 0, now);
  const e = { ...(grow.extras || {}) };
  e.trips = (e.trips || 0) + 1;
  e.collection = [...(e.collection || []), res.item].slice(-60);
  grow = growstore.save({ ...grow, trip: null, extras: e });
  if (win && !win.isDestroyed()) {
    win.webContents.send('whale:postcard', { report: { ...res.report, early: !!early }, item: res.item });
  }
  pushTrip();
  checkAchievements();
  return { ok: true, report: res.report, item: res.item };
}

function tickTrip() {
  if (!grow.trip) return;
  if (!gameplay.isTripDone(grow.trip, Date.now())) return;
  finishTravel(false);
}

/**
 * 食谱图鉴：cc-switch 里出现过新模型 → 解锁一道菜。
 * 首次运行只把已有的模型登记进去，不弹提示（否则开箱就刷屏）。
 */
function tickMenu(state) {
  const menu = (state && state.menu) || [];
  if (!menu.length) return;

  const e = { ...(grow.extras || {}) };
  const dishes = { ...(e.dishes || {}) };
  const seeded = !!e.dishesSeeded;
  let changed = false;
  const fresh = [];

  for (const item of menu) {
    if (dishes[item.model]) continue;
    const dish = gameplay.dishFor(item.model);
    dishes[item.model] = {
      name: dish.name,
      emoji: dish.emoji,
      tier: dish.tier,
      firstAt: Date.now(),
      firstSeenTokens: item.tokens || 0,
    };
    if (seeded) fresh.push({ model: item.model, ...dish });
    changed = true;
  }

  if (!seeded) {
    e.dishesSeeded = true;
    changed = true;
  }

  if (!changed) return;
  e.dishes = dishes;
  grow = growstore.save({ ...grow, extras: e });

  if (fresh.length && windowReady && win && !win.isDestroyed()) {
    for (const d of fresh) win.webContents.send('whale:dish', d);
  }
}

function tickRest() {
  if (cfg.restRemind === false) return;
  const now = Date.now();
  const activity = (prevState && prevState.activity) || {};
  const e = { ...(grow.extras || {}) };
  const rest = { ...(e.rest || {}) };
  const active = activity.lastAt && now - activity.lastAt < 5 * 60000;

  if (!active) {
    if (rest.sessionStart) {
      rest.sessionStart = 0;
      e.rest = rest;
      grow = growstore.save({ ...grow, extras: e });
    }
    return;
  }

  if (!rest.sessionStart) {
    rest.sessionStart = now;
    e.rest = rest;
    grow = growstore.save({ ...grow, extras: e });
    return;
  }

  if (now - rest.sessionStart > 90 * 60000 && now - (rest.lastNagAt || 0) > 60 * 60000) {
    rest.lastNagAt = now;
    e.rest = rest;
    grow = growstore.save({ ...grow, extras: e });
    if (win && !win.isDestroyed()) {
      win.webContents.send('whale:rest', { minutes: Math.round((now - rest.sessionStart) / 60000) });
    }
  }
}

function doInteract(kind) {
  const before = petstate.rankOf(grow.affinity.points);
  const res = petstate.interact(grow, kind);
  grow = petstate.settleTreats(res.state).state;
  grow = growstore.save(grow);

  const after = petstate.rankOf(grow.affinity.points);
  return {
    accepted: res.accepted,
    delta: res.delta,
    reaction: res.reaction,
    reason: res.reason,
    cooldownLeft: res.cooldownLeft,
    grow: petstate.view(grow),
    levelUp: after.name !== before.name ? { from: before.name, to: after.name, stars: after.stars } : null,
  };
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(() => poll(false), POLL_MS);
  poll(true);
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

/* ----------------------------- 行为 ----------------------------- */

function applyConfig(patch) {
  cfg = store.set(patch);

  if (win && !win.isDestroyed()) {
    if ('alwaysOnTop' in patch) win.setAlwaysOnTop(!!cfg.alwaysOnTop, 'screen-saver');
    win.webContents.send('whale:config', cfg);
    if ('skin' in patch) win.webContents.send('whale:skin', skins.get(cfg.skin));
    // 关掉实时字幕时立刻收起面板
    if ('showLive' in patch && cfg.showLive === false) {
      win.webContents.send('whale:live', { ev: { kind: 'idle' }, state: {} });
    }
  }
  if ('autoLaunch' in patch) {
    try {
      app.setLoginItemSettings({
        openAtLogin: !!cfg.autoLaunch,
        path: process.execPath,
        args: app.isPackaged ? [] : [app.getAppPath()],
      });
    } catch (_) {}
  }
  refreshTrayMenu();
  return cfg;
}

function createDesktopShortcut() {
  try {
    const desktop = app.getPath('desktop');
    const lnk = path.join(desktop, '鲸鱼娘.lnk');
    const target = process.execPath;
    const args = app.isPackaged ? '' : `"${app.getAppPath()}"`;
    const ok = shell.writeShortcutLink(lnk, 'create', {
      target,
      args,
      cwd: path.dirname(target),
      description: '鲸鱼娘 · cc-switch 桌面宠物',
      icon: target,
      iconIndex: 0,
    });
    return { ok, path: lnk, target, args };
  } catch (err) {
    return { ok: false, message: String(err && err.message || err) };
  }
}

function openCCSwitch() {
  const exe = cc.CC_EXE;
  if (!fs.existsSync(exe)) {
    dialog.showMessageBox({
      type: 'info',
      title: '找不到 CC Switch',
      message: '没在预期路径找到 CC Switch 主程序。',
      detail: `预期路径：${exe}\n\n可以在「设置」里修改路径，或直接手动打开。`,
    });
    return;
  }
  shell.openPath(exe);
}

/* ----------------------------- IPC ----------------------------- */

ipcMain.handle('whale:init', () => ({
  config: cfg,
  state: prevState,
  grow: petstate.view(grow),
  meta: petstate.metaView(grow.meta),
  trip: viewTrip(),
  budget: gameplay.budgetView(grow.meta || {}, cfg.dailyBowls || 0),
  profile: profileView(),
  live: {
    active: liveState.active,
    provider: liveState.provider,
    startedAt: liveState.startedAt,
    tools: liveState.tools,
  },
  skins: skins.list().skins.map(({ tracks, rows, ...rest }) => rest),
  skin: skins.get(cfg.skin || 'whale'),
  voices: voice.list(),
  platform: process.platform,
  ccExe: cc.CC_EXE,
}));

ipcMain.handle('whale:save', (_e, patch) => applyConfig(patch || {}));

ipcMain.on('whale:setIgnore', (_e, ignore) => {
  if (win && !win.isDestroyed()) win.setIgnoreMouseEvents(!!ignore, { forward: true });
});

ipcMain.handle('whale:getBounds', () => {
  if (!win || win.isDestroyed()) return { x: 0, y: 0, width: W, height: H, workArea: screen.getPrimaryDisplay().workArea };
  const b = win.getBounds();
  const disp = screen.getDisplayNearestPoint({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
  return { ...b, workArea: disp.workArea };
});

ipcMain.on('whale:move', (_e, pos) => {
  if (!win || win.isDestroyed()) return;
  if (!pos) return;
  placeWindow(pos.x, pos.y);
});

ipcMain.on('whale:drop', () => {
  if (!win || win.isDestroyed()) return;
  const [x, y] = win.getPosition();
  const disp = screen.getDisplayNearestPoint({ x: x + W / 2, y: y + H / 2 });
  const a = disp.workArea;
  const snap = 56;
  let nx = x;
  let ny = y;

  if (Math.abs(x - a.x) < snap) nx = a.x;
  else if (Math.abs(a.x + a.width - (x + W)) < snap) nx = a.x + a.width - W;

  if (Math.abs(y - a.y) < snap) ny = a.y;
  else if (Math.abs(a.y + a.height - (y + H)) < snap) ny = a.y + a.height - H;

  const bottomTooFar = y + H > a.y + a.height + 20;
  if (bottomTooFar) ny = a.y + a.height - H;

  placeWindow(nx, ny);
  store.set({ x: Math.round(nx), y: Math.round(ny) });
});

ipcMain.handle('whale:switch', async (_e, { appType, id }) => {
  if (!appType || !id) return { ok: false, message: '参数不对' };

  if (!cfg.allowSwitch) {
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: ['先不用', '允许并切换'],
      defaultId: 1,
      cancelId: 0,
      title: '让鲸鱼娘帮你切供应商？',
      message: '这会把 cc-switch 的供应商配置写进本地 CLI 配置文件。',
      detail:
        '会发生三件事：\n1. 备份现有配置和数据库到宠物自己的目录；\n2. 写入对应 CLI 的配置文件（如 ~/.claude/settings.json）；\n3. 同步 cc-switch 数据库里的“当前供应商”。\n\n如果 CC Switch 正在运行，切换后建议重启它以刷新状态。',
    });
    if (response !== 1) return { ok: false, canceled: true };
    applyConfig({ allowSwitch: true });
  }

  try {
    const backupRoot = path.join(app.getPath('userData'), 'backups');
    const result = cc.switchProvider(appType, id, backupRoot);
    if (result.ok) {
      const [x, y] = win.getPosition();
      store.set({ x, y });
      const e = { ...(grow.extras || {}) };
      e.switches = (e.switches || 0) + 1;
      grow = growstore.save({ ...grow, extras: e });
      checkAchievements();
      setTimeout(() => poll(true), 300);
    }
    return result;
  } catch (err) {
    return { ok: false, message: String(err.message || err) };
  }
});

ipcMain.handle('whale:grow', () => petstate.view(grow));

ipcMain.handle('whale:speak', (_e, payload) => {
  const p = payload || {};
  return voice.say(p.text, { voice: p.voice || cfg.voiceName, rate: p.rate || cfg.voiceRate });
});

ipcMain.handle('whale:skins', () => ({
  list: skins.list().skins.map(({ tracks, rows, ...rest }) => rest),
  current: cfg.skin || 'whale',
  broken: skins.list().broken,
}));

ipcMain.handle('whale:skin:set', (_e, id) => {
  const target = skins.get(id);
  if (!target) return { ok: false, message: '没有这个皮肤' };
  applyConfig({ skin: target.id });
  return { ok: true, skin: target };
});

ipcMain.handle('whale:profile', () => profileView());

ipcMain.handle('whale:reply:send', (_e, payload) => {
  if (payload && typeof payload === 'object') return sendReply(payload.text, payload.id);
  return sendReply(payload);
});

ipcMain.handle('replyw:list', () => {
  const codexSessions = reply.listSessions(8).map((s) => ({ ...s, kind: 'codex', readonly: false }));
  let wbSessions = [];
  try {
    wbSessions = wbchat.listSessions(4);
  } catch (_) {
    wbSessions = [];
  }
  // Codex 在前（可发），WorkBuddy 在后（只读），各自按时间排
  return [...codexSessions, ...wbSessions];
});
ipcMain.handle('replyw:send', (_e, payload) => {
  const { id, text } = payload || {};
  return sendReply(text, id);
});
ipcMain.on('replyw:close', () => {
  if (replyWin && !replyWin.isDestroyed()) replyWin.close();
});
ipcMain.handle('whale:reply:status', () => replyStatus());
ipcMain.handle('whale:copy', (_e, text) => {
  clipboard.writeText(String(text || ''));
  return { ok: true };
});
ipcMain.handle('whale:trip:start', (_e, destId) => startTravel(destId));
ipcMain.handle('whale:trip:recall', () => finishTravel(true));

ipcMain.handle('whale:interact', (_e, kind) => {
  if (kind !== 'pet' && kind !== 'feed') return { accepted: false, reaction: '', reason: 'unknown', grow: petstate.view(grow) };
  return doInteract(kind);
});

function showShortcutResult(r) {
  if (!r.ok) {
    dialog.showMessageBox({ type: 'error', title: '创建失败', message: '没能创建桌面快捷方式', detail: r.message || '' });
    return;
  }
  dialog.showMessageBox({
    type: 'info',
    title: '已创建',
    message: '桌面快捷方式已创建：鲸鱼娘.lnk',
    detail: r.path,
    buttons: ['好'],
  });
}

ipcMain.on('whale:opencc', openCCSwitch);

ipcMain.on('whale:menu', () => {
  const template = [
    { label: '显示状态卡', click: () => win && win.webContents.send('whale:cmd', 'toggle-card') },
    { label: '喂一条小鱼干', click: () => win && win.webContents.send('whale:cmd', 'feed') },
    { type: 'separator' },
    {
      label: '窗口置顶',
      type: 'checkbox',
      checked: !!cfg.alwaysOnTop,
      click: (item) => applyConfig({ alwaysOnTop: item.checked }),
    },
    {
      label: '开机自启',
      type: 'checkbox',
      checked: !!cfg.autoLaunch,
      click: (item) => applyConfig({ autoLaunch: item.checked }),
    },
    { label: '回复当前任务…', click: () => createReplyWindow() },
    { label: '查看最近回复', click: () => win && win.webContents.send('whale:cmd', 'reply-last') },
    {
      label: 'WorkBuddy 活动（只读）',
      type: 'checkbox',
      checked: cfg.showWorkbuddy !== false,
      click: (item) => applyConfig({ showWorkbuddy: item.checked }),
    },
    {
      label: '语音播报结论',
      type: 'checkbox',
      checked: cfg.voice !== false,
      click: (item) => applyConfig({ voice: item.checked }),
    },
    {
      label: '语音音色',
      submenu: [
        ...voice.list().map((v) => ({
          label: `${v.name} · ${v.desc}`,
          type: 'radio',
          checked: (cfg.voiceEngine || 'edge') === 'edge' && (cfg.voiceName || 'zh-CN-XiaoxiaoNeural') === v.id,
          click: () => applyConfig({ voiceEngine: 'edge', voiceName: v.id }),
        })),
        { type: 'separator' },
        {
          label: '系统语音（离线备用）',
          type: 'radio',
          checked: cfg.voiceEngine === 'system',
          click: () => applyConfig({ voiceEngine: 'system' }),
        },
      ],
    },
    {
      label: '语速',
      submenu: [
        { label: '慢', type: 'radio', checked: Number(cfg.voiceRate) === 0.9, click: () => applyConfig({ voiceRate: 0.9 }) },
        { label: '正常', type: 'radio', checked: Number(cfg.voiceRate) === 1.05, click: () => applyConfig({ voiceRate: 1.05 }) },
        { label: '快', type: 'radio', checked: Number(cfg.voiceRate) === 1.25, click: () => applyConfig({ voiceRate: 1.25 }) },
      ],
    },
    {
      label: '实时字幕（跟随 Codex / Claude 会话）',
      type: 'checkbox',
      checked: cfg.showLive !== false,
      click: (item) => applyConfig({ showLive: item.checked }),
    },
    {
      label: '允许宠物切换供应商',
      type: 'checkbox',
      checked: !!cfg.allowSwitch,
      click: (item) => applyConfig({ allowSwitch: item.checked }),
    },
    {
      label: '对话气泡',
      type: 'checkbox',
      checked: !!cfg.showBubble,
      click: (item) => applyConfig({ showBubble: item.checked }),
    },
    { label: '皮肤', submenu: skinMenuItems() },
    {
      label: '大小',
      submenu: [
        { label: '小', type: 'radio', checked: cfg.scale === 0.56, click: () => applyConfig({ scale: 0.56 }) },
        { label: '中', type: 'radio', checked: cfg.scale === 0.72, click: () => applyConfig({ scale: 0.72 }) },
        { label: '大', type: 'radio', checked: cfg.scale === 0.9, click: () => applyConfig({ scale: 0.9 }) },
      ],
    },
    ...gameplayMenuItems(),
    { type: 'separator' },
    { label: '创建桌面快捷方式', click: () => showShortcutResult(createDesktopShortcut()) },
    { label: '打开 CC Switch', click: openCCSwitch },
    { label: '刷新数据', click: () => poll(true) },
    { type: 'separator' },
    { label: '隐藏宠物（点托盘图标回来）', click: () => win && win.hide() },
    { label: '退出', click: () => app.quit() },
  ];
  Menu.buildFromTemplate(template).popup({ window: win });
});

ipcMain.on('whale:quit', () => app.quit());

app.on('before-quit', () => {
  stopPolling();
  if (liveFeed) liveFeed.stop();
  if (wbChat) wbChat.stop();
  if (wbFeed) wbFeed.stop();
  if (liveWatch) clearInterval(liveWatch);
  if (win) {
    const [x, y] = win.getPosition();
    store.set({ x, y });
  }
});
