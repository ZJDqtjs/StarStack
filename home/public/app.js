/* 星栈算力欢迎页 — 下载清单渲染 + SVG 调度演示
 * 零依赖。下载直链使用 releases/latest/download/<file>，
 * 即使 GitHub API 被限流或尚未发布，链接在首个 Release 上线后也会自动生效。
 */
(function () {
  'use strict';

  var REPO = 'ZJDqtjs/StarStack';
  var RELEASES_URL = 'https://github.com/' + REPO + '/releases';
  var LATEST_BASE = RELEASES_URL + '/latest/download/';
  var API_URL = 'https://api.github.com/repos/' + REPO + '/releases/latest';
  var BROKER_DL = 'https://starstack.run/dl/';

  var ICONS = {
    windows: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 5.5 10.6 4.5v7H3zm0 13 7.6 1v-6.9H3zM11.7 4.3 21 3v8.5h-9.3zM11.7 19.7 21 21v-8.4h-9.3z"/></svg>',
    darwin: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.4 12.7c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.9-3.5.9s-1.8-.8-3-.8c-1.5 0-3 .9-3.8 2.3-1.6 2.8-.4 7 1.2 9.3.8 1.1 1.7 2.4 2.9 2.3 1.2 0 1.6-.7 3-.7s1.8.7 3 .7 2-1.1 2.8-2.2c.9-1.3 1.3-2.5 1.3-2.6-.1 0-2.5-1-2.5-3.9zM14.2 5.9c.6-.8 1-1.9.9-3-.9 0-2 .6-2.7 1.4-.6.7-1.1 1.8-1 2.9 1 .1 2.1-.5 2.8-1.3z"/></svg>',
    linux: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M12.5 15H17"/></svg>',
    desktop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="2.5" y="3.5" width="19" height="13" rx="2"/><path d="M8 20.5h8M12 16.5v4"/></svg>',
    android: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M5 10a7 7 0 0 1 14 0v7a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z"/><path d="M5 10h14M8 18v3M16 18v3M9 6.5 7.5 4M15 6.5 16.5 4"/><circle cx="9" cy="14" r=".8" fill="currentColor"/><circle cx="15" cy="14" r=".8" fill="currentColor"/></svg>',
    miniapp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M9 3.5C5 3.5 2.5 6 2.5 9.2c0 1.8 1 3.4 2.5 4.4L4.5 16l2.3-1.2c.7.2 1.4.3 2.2.3h.5"/><path d="M15 8c4 0 6.5 2.3 6.5 5.3 0 1.7-.9 3.2-2.3 4.2l.5 2.2-2.2-1.1c-.8.2-1.6.4-2.5.4-4 0-6.5-2.4-6.5-5.4S11 8 15 8z"/></svg>',
    harmony: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="2.2"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4M5.3 5.3l2.8 2.8M15.9 15.9l2.8 2.8M18.7 5.3l-2.8 2.8M8.1 15.9l-2.8 2.8"/></svg>'
  };

  /* CI 产物清单：与 .github/workflows/release.yml 中的命名保持一致。
   * group=desktop/android/miniapp/harmony 是四个客户端；node 是算力节点与 Broker。
   * miniapp / harmony 只能提供源码包：小程序没有可安装文件，鸿蒙 HAP 需要
   * DevEco Studio 5.x + 华为账号签名，CI 里构建不出来。别把它们伪装成安装包。 */
  var ASSETS = [
    { group: 'desktop', os: 'desktop', osLabel: 'Windows 桌面', arch: 'x64', file: 'StarStack.Desktop.exe', kind: '安装包', client: true,
      desc: '自包含单文件，双击即用', note: '无需 .NET 运行时' },
    { group: 'android', os: 'android', osLabel: 'Android', arch: '通用', file: 'StarStack-RN.apk', kind: '安装包', client: true,
      desc: 'RN 原生端：买方控制台 + 常驻算力节点', note: '需允许「未知来源」' },
    { group: 'miniapp', os: 'miniapp', osLabel: '微信小程序', arch: '源码', file: 'starstack-miniapp-source.zip', kind: '源码包', client: true,
      desc: '微信开发者工具导入', note: '测试号 touristappid' },
    { group: 'harmony', os: 'harmony', osLabel: 'HarmonyOS NEXT', arch: '源码', file: 'starstack-harmony-source.zip', kind: '源码包', client: true,
      desc: 'ArkTS 壳 + 内嵌 Web 控制台', note: '需 DevEco 5.x 签名' },

    { group: 'node', os: 'windows', osLabel: 'Windows', arch: 'x86-64', file: 'starstack-worker-windows-amd64.exe', kind: '算力节点' },
    { group: 'node', os: 'windows', osLabel: 'Windows', arch: 'ARM64', file: 'starstack-worker-windows-arm64.exe', kind: '算力节点' },
    { group: 'node', os: 'darwin', osLabel: 'macOS', arch: 'Apple Silicon', file: 'starstack-worker-darwin-arm64', kind: '算力节点' },
    { group: 'node', os: 'darwin', osLabel: 'macOS', arch: 'Intel', file: 'starstack-worker-darwin-amd64', kind: '算力节点' },
    { group: 'node', os: 'linux', osLabel: 'Linux', arch: 'x86-64', file: 'starstack-worker-linux-amd64', kind: '算力节点' },
    { group: 'node', os: 'linux', osLabel: 'Linux', arch: 'ARM64', file: 'starstack-worker-linux-arm64', kind: '算力节点' },
    { group: 'node', os: 'linux', osLabel: 'Linux', arch: 'x86-64', file: 'starstack-server-linux-amd64', kind: 'Broker 服务端', server: true },
    { group: 'node', os: 'linux', osLabel: 'Linux', arch: '校验和', file: 'SHA256SUMS.txt', kind: '完整性校验', server: true }
  ];

  function fmtSize(bytes) {
    if (typeof bytes !== 'number') return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }

  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  var grid = document.getElementById('download-grid');
  var badge = document.getElementById('release-badge');
  var badgeText = document.getElementById('release-text');
  var notice = document.getElementById('download-notice');
  /* unknown = 还没拿到 API 结果（或 API 被限流），此时仍给出可用的直链 */
  var releaseState = 'unknown';

  /* 线上 Broker 的 /dl/ 目录里真实存在的文件（已用 HEAD 逐个确认）。
   * GitHub 还没有 Release 时，这六个节点程序仍然可以直接下；exe / apk / Broker
   * 二进制不在 /dl/ 里，别在页面上假装能下。 */
  var BROKER_FILES = {
    'starstack-worker-windows-amd64.exe': 1,
    'starstack-worker-windows-arm64.exe': 1,
    'starstack-worker-linux-amd64': 1,
    'starstack-worker-linux-arm64': 1,
    'starstack-worker-darwin-amd64': 1,
    'starstack-worker-darwin-arm64': 1
  };

  /* 每张卡片的最终去向与说辞都从这里算，避免「按钮能点、点了 404」 */
  function resolve(a, byName) {
    var found = byName && byName[a.file];
    if (releaseState === 'ready') {
      if (found && found.browser_download_url) {
        return { href: found.browser_download_url, label: a.kind === '源码包' ? '下载源码' : '下载',
          status: '已发布', src: 'GitHub Release', size: found.size, ok: true };
      }
      return { href: RELEASES_URL, label: '查看 Releases', status: '该版本未包含',
        src: '本版未构建', size: null, ok: false };
    }
    if (BROKER_FILES[a.file]) {
      return { href: BROKER_DL + a.file, label: 'Broker 直链', status: '可下载',
        src: '线上 Broker', size: null, ok: true };
    }
    if (releaseState === 'empty') {
      return { href: RELEASES_URL, label: '待首个 Release', status: '尚未发布',
        src: '仓库暂无 Release', size: null, ok: false };
    }
    return { href: LATEST_BASE + a.file, label: '直链下载', status: '版本信息未知',
      src: 'latest/download', size: null, ok: true };
  }

  function renderCards(assetsByName) {
    grid.innerHTML = '';
    ASSETS.forEach(function (a) {
      var r = resolve(a, assetsByName);
      var card = document.createElement('article');
      card.className = 'dl-card' + (a.client ? ' is-client' : '') + (a.server ? ' is-server' : '');
      card.dataset.group = a.group;
      card.innerHTML =
        '<div class="dl-top">' +
          '<span class="dl-os">' + (ICONS[a.os] || ICONS.linux) + '</span>' +
          '<div><div class="dl-name">' + a.osLabel + ' <span class="dl-arch">' + a.arch + '</span></div>' +
          '<div class="dl-arch">' + a.kind + '</div></div>' +
        '</div>' +
        (a.client ? '<div class="dl-desc">' + a.desc + '<span>' + a.note + '</span></div>' : '') +
        '<div class="dl-file">' + a.file + '</div>' +
        '<div class="dl-src">' + r.src + '</div>' +
        '<div class="dl-meta"><span>' + (r.size ? fmtSize(r.size) : '—') + '</span>' +
          '<span>' + r.status + '</span></div>' +
        '<a class="dl-btn' + (r.ok ? '' : ' is-disabled') + '" href="' + r.href + '"' +
          (r.ok ? ' target="_blank" rel="noopener noreferrer"' : ' aria-disabled="true" tabindex="-1"') +
          '>' + r.label + ' <span aria-hidden="true">' + (r.ok ? '↓' : '↗') + '</span></a>';
      grid.appendChild(card);
    });
    applyFilter(currentGroup);
  }

  var currentGroup = 'all';
  function applyFilter(group) {
    currentGroup = group;
    Array.prototype.forEach.call(grid.querySelectorAll('.dl-card'), function (card) {
      card.classList.toggle('is-hidden', group !== 'all' && card.dataset.group !== group);
    });
  }

  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (tab) {
    tab.addEventListener('click', function () {
      Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
        t.classList.remove('is-active');
        t.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('is-active');
      tab.setAttribute('aria-selected', 'true');
      applyFilter(tab.dataset.group);
    });
  });

  renderCards(null);

  /* GitHub API 只用来做「增强」：版本号、大小、真实下载地址。
   * 失败 / 限流 / 无 Release 都不能让下载区变成空白。 */
  (function loadRelease() {
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, 7000) : null;
    var opts = { headers: { Accept: 'application/vnd.github+json' } };
    if (controller) opts.signal = controller.signal;

    fetch(API_URL, opts).then(function (res) {
      if (res.status === 404) return null;
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function (data) {
      if (timer) clearTimeout(timer);
      if (!data) {
        releaseState = 'empty';
        badge.classList.add('is-empty');
        badgeText.textContent = '尚无 Release · 等待首个 v* 标签';
        notice.hidden = false;
        var fallback = document.createElement('span');
        fallback.innerHTML = '节点程序可先从线上 Broker 直接取：' +
          '<a href="' + BROKER_DL + 'starstack-worker-windows-amd64.exe" target="_blank" rel="noopener noreferrer">Windows x64 ↗</a>' +
          ' <a href="' + BROKER_DL + 'starstack-worker-linux-amd64" target="_blank" rel="noopener noreferrer">Linux x64 ↗</a>' +
          ' <a href="' + BROKER_DL + 'starstack-worker-darwin-arm64" target="_blank" rel="noopener noreferrer">macOS ARM ↗</a>';
        notice.appendChild(fallback);
        renderCards(null);
        return;
      }
      var byName = {};
      (data.assets || []).forEach(function (asset) { byName[asset.name] = asset; });
      releaseState = 'ready';
      badge.classList.add('is-ready');
      badgeText.textContent = (data.tag_name || 'latest') + ' · ' + fmtDate(data.published_at);
      renderCards(byName);
    }).catch(function () {
      if (timer) clearTimeout(timer);
      badgeText.textContent = '版本信息暂不可用 · 直链仍然有效';
      renderCards(null);
    });
  })();

  /* ── SVG 调度演示 ───────────────────────────────────────── */
  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var SPEED = REDUCED ? 0.12 : 1;
  var runId = 0;
  var stage = document.getElementById('demo-stage');
  var caption = document.getElementById('phase-caption');
  var phaseTag = document.getElementById('log-phase');
  var logList = document.getElementById('log-lines');
  var flying = document.getElementById('flying');
  var faultToggle = document.getElementById('fault-toggle');
  var replayBtn = document.getElementById('demo-replay');

  function el(id) { return document.getElementById(id); }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms * SPEED); }); }
  function alive(token) { return token === runId; }

  function log(text, kind) {
    var li = document.createElement('li');
    if (kind) li.className = 'log-' + kind;
    li.textContent = text;
    logList.appendChild(li);
    logList.scrollTop = logList.scrollHeight;
  }

  function setPhase(name, text) {
    stage.dataset.phase = name;
    phaseTag.textContent = name;
    caption.textContent = text;
  }

  function reset() {
    logList.innerHTML = '';
    flying.innerHTML = '';
    ['a', 'b', 'c'].forEach(function (n) {
      var card = el('card-node-' + n);
      card.classList.remove('is-on', 'is-offline', 'is-busy');
      el('bar-' + n).style.transform = 'scaleX(0)';
      el('count-' + n).textContent = '0 片';
    });
    for (var i = 0; i < 4; i++) {
      el('seg-' + i).setAttribute('class', 'seg');
      el('v-' + i).classList.remove('is-ok');
      el('v-' + i).textContent = '#' + (i + 1) + '  SHA-256 待校验';
    }
    ['slice', 'a', 'b', 'c', 'v', 'merge'].forEach(function (id) {
      el('act-' + id).classList.remove('is-on');
    });
    el('verify-total').textContent = '0/4 一致';
    el('merge-fill').style.transform = 'scaleX(0)';
    el('settle').textContent = '实结 — 点 · 墙钟 — s';
    el('settle').classList.remove('is-on');
    el('card-verify').classList.remove('is-on');
  }

  function fly(segIndex, nodeKey) {
    var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    var rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', 0); rect.setAttribute('y', 0);
    rect.setAttribute('width', 62); rect.setAttribute('height', 24);
    rect.setAttribute('rx', 5);
    var text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', 8); text.setAttribute('y', 16);
    text.textContent = 'seg #' + (segIndex + 1);
    g.appendChild(rect); g.appendChild(text);
    var fromY = 166 + segIndex * 38;
    var toY = { a: 100, b: 188, c: 276 }[nodeKey];
    g.setAttribute('transform', 'translate(240 ' + fromY + ')');
    g.style.opacity = '0';
    flying.appendChild(g);
    // 强制一次布局，让 transition 有起点
    void g.getBoundingClientRect();
    g.style.opacity = '1';
    g.setAttribute('transform', 'translate(410 ' + toY + ')');
    setTimeout(function () {
      g.style.opacity = '0';
      setTimeout(function () { if (g.parentNode) g.parentNode.removeChild(g); }, 420);
    }, 800 * SPEED);
  }

  var ASSIGN = { 0: 'a', 1: 'b', 2: 'b', 3: 'c' };

  async function play() {
    var token = ++runId;
    var fault = faultToggle.checked;
    reset();
    setPhase('probe', 'ffprobe 探测源片与关键帧');
    log('job demo-4seg: input.mp4 60.0s 1080p → 720p, libx264 veryfast, 4 分片');

    await wait(520); if (!alive(token)) return;
    el('act-slice').classList.add('is-on');
    setPhase('slice', '按 IDR 帧对齐切点，避免花屏与音画不同步');
    for (var i = 0; i < 4; i++) {
      el('seg-' + i).setAttribute('class', 'seg is-on');
      log('seg #' + (i + 1) + ' 规划完成 · 15.0s · 关键帧对齐');
      await wait(170); if (!alive(token)) return;
    }

    setPhase('dispatch', '硬约束过滤 + 软评分匹配，派发即占槽');
    ['a', 'b', 'c'].forEach(function (id) { el('act-' + id).classList.add('is-on'); });
    for (var s = 0; s < 4; s++) {
      var nodeKey = ASSIGN[s];
      fly(s, nodeKey);
      el('card-node-' + nodeKey).classList.add('is-on', 'is-busy');
      el('seg-' + s).classList.add('is-dispatched');
      await wait(230); if (!alive(token)) return;
    }
    var counts = { a: 0, b: 0, c: 0 };
    Object.keys(ASSIGN).forEach(function (k) { counts[ASSIGN[k]]++; });
    ['a', 'b', 'c'].forEach(function (n) { el('count-' + n).textContent = counts[n] + ' 片'; });
    log('派发完成：node-a 1 片 / node-b 2 片 / node-c 1 片；单价已冻进 seg.PriceAt', 'ok');

    await wait(320); if (!alive(token)) return;
    setPhase('execute', '节点并行转码，心跳随进度刷新租约');
    ['a', 'b', 'c'].forEach(function (n) { if (counts[n]) el('bar-' + n).style.transform = 'scaleX(1)'; });
    log('node-a: seg #1 transcoding… 6.3s');
    log('node-b: seg #2 / #3 transcoding…');
    log('node-c: seg #4 transcoding…');

    if (fault) {
      await wait(620); if (!alive(token)) return;
      setPhase('reclaim', '25s 无心跳 → 立即回收分片并重派');
      el('card-node-b').classList.remove('is-busy');
      el('card-node-b').classList.add('is-offline');
      el('bar-b').style.transform = 'scaleX(0.45)';
      el('count-b').textContent = '离线';
      el('seg-1').classList.add('is-failed');
      el('seg-2').classList.add('is-failed');
      log('WARN node-b offline: 25s 无心跳，回收其持有的分片', 'warn');
      log('reclaiming job demo-4seg seg #2 from node-b (node offline, attempt 1)', 'warn');
      log('reclaiming job demo-4seg seg #3 from node-b (node offline, attempt 1)', 'warn');
      log('分片级 Excluded：node-b 不会再接回这两片；老节点迟到的回传一律 409');

      await wait(520); if (!alive(token)) return;
      el('seg-1').classList.remove('is-failed');
      el('seg-2').classList.remove('is-failed');
      el('seg-1').classList.add('is-dispatched');
      el('seg-2').classList.add('is-dispatched');
      fly(1, 'a'); fly(2, 'c');
      el('count-a').textContent = '2 片';
      el('count-c').textContent = '2 片';
      log('重派完成：#2 → node-a，#3 → node-c（attempt=1）', 'ok');
      await wait(760); if (!alive(token)) return;
    } else {
      await wait(1080); if (!alive(token)) return;
    }

    setPhase('verify', '节点回传哈希，Broker 落盘时独立重算');
    el('act-v').classList.add('is-on');
    for (var v = 0; v < 4; v++) {
      el('v-' + v).textContent = '#' + (v + 1) + '  SHA-256 verified=true';
      el('v-' + v).classList.add('is-ok');
      el('seg-' + v).classList.remove('is-dispatched');
      el('seg-' + v).classList.add('is-done');
      el('verify-total').textContent = (v + 1) + '/4 一致';
      log('seg #' + (v + 1) + ' done: verified=true, cost 按冻结价结算', 'ok');
      await wait(230); if (!alive(token)) return;
    }

    await wait(240); if (!alive(token)) return;
    setPhase('merge', 'concat demuxer + -c copy，不二次编码');
    el('act-merge').classList.add('is-on');
    el('merge-fill').style.transform = 'scaleX(1)';
    log('merge: 4 分片 → output.mp4 60.1s，全片解码无错误（接缝干净）');

    await wait(760); if (!alive(token)) return;
    setPhase('settle', fault ? '完成 · 掉线未造成卡死，也没有重复结算' : '完成 · 真实加速比 1.45×');
    el('settle').textContent = fault ? '分片仅结算一次 · 无二次计费' : '墙钟 7.5s · 加速 1.45×';
    el('settle').classList.add('is-on');
    log(fault
      ? 'job done: 掉线分片由其它节点接手，各片各结算一次，账本无重复流水'
      : 'job done: wall=7.5s seg-sum=24.8s baseline=10.9s speedup=1.45× parallel=3.3×', 'ok');
    log('诚实注记：节点跑在同机时抢的是同一组 CPU/GPU，加速比不是节点数的线性函数。');
  }

  // 可分享的故障演示直链：https://home.starstack.run/?fault=1
  if (new URLSearchParams(window.location.search).has('fault')) {
    faultToggle.checked = true;
  }

  replayBtn.addEventListener('click', play);
  faultToggle.addEventListener('change', play);
  if ('IntersectionObserver' in window) {
    var observer = new IntersectionObserver(function (entries) {
      if (entries.some(function (e) { return e.isIntersecting; })) {
        observer.disconnect();
        play();
      }
    }, { threshold: 0.25 });
    observer.observe(document.getElementById('demo-stage'));
  } else {
    play();
  }

  /* ── 分解动画：进入可视区才播放，离屏一律暂停 ───────────── */
  (function motion() {
    var cards = document.querySelectorAll('[data-motion]');
    if (!cards.length) return;
    if (!('IntersectionObserver' in window)) {
      Array.prototype.forEach.call(cards, function (c) { c.classList.add('is-live'); });
      return;
    }
    var mo = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { e.target.classList.toggle('is-live', e.isIntersecting); });
    }, { threshold: 0.25 });
    Array.prototype.forEach.call(cards, function (c) { mo.observe(c); });
  })();
})();
