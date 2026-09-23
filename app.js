/**
 * US Chokepoint Dashboard - Frontend Application
 * High Information Density, Native ESModule, Zero Overhead
 * Real-time US Stock Quote Engine & Resilient Market-Aware Scheduler
 */

let currentData = null;
let realtimeQuotes = {};
let currentView = 'cards'; // 'cards' | 'table'
let lastQuoteTime = null;
let lastESTTime = null;
let isRefreshing = false;
let hourlyIntervalId = null;

// Domain classification map for quick filtering
const DOMAIN_GROUPS = {
  CHIP: ['TSM', 'NVDA', 'AVGO'],
  EQUIP: ['ASML', 'LRCX', 'AMAT'],
  MEMORY: ['SKHY', 'MU'],
  POWER: ['GEV', 'ETN', 'VRT', 'APH']
};

// Tencent Financial API Symbol Mapping
const SYMBOL_TO_TENCENT = {
  TSM:  'usTSM',
  NVDA: 'usNVDA',
  ASML: 'usASML',
  AVGO: 'usAVGO',
  SKHY: 'usSKHY',
  LRCX: 'usLRCX',
  AMAT: 'usAMAT',
  MU:   'usMU',
  GEV:  'usGEV',
  ETN:  'usETN',
  VRT:  'usVRT',
  APH:  'usAPH'
};

/**
 * Robust US Eastern Time & Market Status Detection using standard Intl API
 */
function getUSEasternTimeInfo(date = new Date()) {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      weekday: 'short',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: false
    });
    const parts = formatter.formatToParts(date);
    const map = {};
    parts.forEach(p => map[p.type] = p.value);

    const weekday = map.weekday;
    const hour = parseInt(map.hour, 10);
    const minute = parseInt(map.minute, 10);
    const minuteOfDay = hour * 60 + minute;
    const isWeekday = !['Sat', 'Sun'].includes(weekday);
    const isOpen = isWeekday && (minuteOfDay >= 570 && minuteOfDay < 960); // 9:30 AM (570) to 4:00 PM (960)

    const pad = (v) => String(v).padStart(2, '0');
    return {
      isOpen,
      timeString: `${pad(hour)}:${pad(minute)}:${pad(map.second)}`,
      dateString: `${map.year}-${pad(map.month)}-${pad(map.day)}`,
      weekday
    };
  } catch (e) {
    console.warn('Intl timezone calculation fallback:', e);
    return { isOpen: true, timeString: '', dateString: '', weekday: '' };
  }
}

function formatShanghaiTime() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const h = pad(d.getHours());
  const min = pad(d.getMinutes());
  const s = pad(d.getSeconds());
  return `${y}-${m}-${day} ${h}:${min}:${s}`;
}

/**
 * Parse four-dimension moat score breakdown
 */
function parseScoreBreakdown(str) {
  if (!str) return [];
  const parts = str.split('｜');
  const labels = {
    '技術': { title: '技術獨占', max: 30 },
    '供需': { title: '供需壁壘', max: 25 },
    '盈利': { title: '盈利質量', max: 25 },
    '增長': { title: '增長空間', max: 20 }
  };
  return parts.map(p => {
    const m = p.match(/(技術|供需|盈利|增長)(\d+)\/(\d+)/);
    if (!m) return null;
    const key = m[1];
    const score = parseInt(m[2], 10);
    const max = parseInt(m[3], 10);
    return {
      key,
      title: labels[key] ? labels[key].title : key,
      score,
      max,
      pct: Math.round((score / max) * 100)
    };
  }).filter(Boolean);
}

function getMoatTierBadge(score) {
  if (score >= 95) return { text: '全球壟斷級護城河', color: 'bg-emerald-950 text-emerald-300 border-emerald-700' };
  if (score >= 90) return { text: '極高壁壘寡頭', color: 'bg-teal-950 text-teal-300 border-teal-700' };
  if (score >= 85) return { text: '高轉換成本核心節點', color: 'bg-blue-950 text-blue-300 border-blue-700' };
  return { text: '關鍵設備不可或缺', color: 'bg-gray-800 text-gray-300 border-gray-700' };
}

/**
 * Fetch real-time quotes from Tencent Financial API.
 * Uses pure Simple GET request (ZERO custom headers) to guarantee NO CORS Preflight blockage.
 */
async function fetchRealtimeQuotes() {
  const queryList = Object.values(SYMBOL_TO_TENCENT).join(',');
  const url = `https://qt.gtimg.cn/q=${queryList}&_t=${Date.now()}`;

  let rawText = '';

  // 1. Direct fetch: standard simple request with 4s timeout
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    const res = await fetch(url, {
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      rawText = await res.text();
    }
  } catch (err) {
    console.warn('Direct simple fetch aborted or failed:', err);
  }

  // 2. Fallback to JSONP script injection
  if (!rawText) {
    rawText = await new Promise((resolve) => {
      const scriptId = 'quote-jsonp-script';
      const prev = document.getElementById(scriptId);
      if (prev) prev.remove();

      const script = document.createElement('script');
      script.id = scriptId;
      script.src = url;

      const safetyTimer = setTimeout(() => {
        if (script.parentNode) script.remove();
        resolve('');
      }, 4000);

      script.onload = () => {
        clearTimeout(safetyTimer);
        let assembled = '';
        for (const [sym, tencentCode] of Object.entries(SYMBOL_TO_TENCENT)) {
          if (window[`v_${tencentCode}`]) {
            assembled += `v_${tencentCode}="${window[`v_${tencentCode}`]}";`;
          }
        }
        script.remove();
        resolve(assembled);
      };

      script.onerror = () => {
        clearTimeout(safetyTimer);
        if (script.parentNode) script.remove();
        resolve('');
      };

      document.head.appendChild(script);
    });
  }

  if (rawText) {
    parseTencentRawQuotes(rawText);
  }

  return realtimeQuotes;
}

/**
 * Parse Tencent GTImg formatted string:
 * v_usNVDA="200~Ӣΰ~NVDA.OQ~228.27~227.38~226.85~...~2026-09-22 11:43:40~0.89~0.39~229.60~..."
 */
function parseTencentRawQuotes(text) {
  const lines = text.split(';').map(s => s.trim()).filter(Boolean);
  const updatedQuotes = {};

  for (const line of lines) {
    const match = line.match(/^v_(us[A-Za-z0-9]+)="(.+)"$/);
    if (!match) continue;

    const tencentKey = match[1];
    const payload = match[2];
    const fields = payload.split('~');

    const targetSymbol = Object.keys(SYMBOL_TO_TENCENT).find(
      sym => SYMBOL_TO_TENCENT[sym] === tencentKey
    );
    if (!targetSymbol) continue;

    const currentPrice = parseFloat(fields[3]);
    const prevClose = parseFloat(fields[4]);
    const openPrice = parseFloat(fields[5]);
    const updateTime = fields[30] || '';
    const changeAmt = parseFloat(fields[31]);
    const changePct = parseFloat(fields[32]);

    updatedQuotes[targetSymbol] = {
      symbol: targetSymbol,
      price: !isNaN(currentPrice) && currentPrice > 0 ? currentPrice.toFixed(2) : '--',
      prevClose: !isNaN(prevClose) ? prevClose.toFixed(2) : '--',
      open: !isNaN(openPrice) ? openPrice.toFixed(2) : '--',
      changeAmt: !isNaN(changeAmt) ? (changeAmt > 0 ? `+${changeAmt.toFixed(2)}` : changeAmt.toFixed(2)) : '0.00',
      changePct: !isNaN(changePct) ? (changePct > 0 ? `+${changePct.toFixed(2)}` : changePct.toFixed(2)) : '0.00',
      isUp: changePct > 0,
      isDown: changePct < 0,
      time: updateTime
    };
  }

  realtimeQuotes = { ...realtimeQuotes, ...updatedQuotes };
  lastQuoteTime = formatShanghaiTime();
  const etInfo = getUSEasternTimeInfo();
  lastESTTime = etInfo.timeString;
}

/**
 * Main dashboard loader:
 * Guaranteed to execute live quote update and refresh all card prices synchronously.
 */
async function loadDashboardData(isManual = false) {
  if (isRefreshing) return;
  isRefreshing = true;

  const refreshIcon = document.getElementById('refresh-icon');
  const refreshText = document.getElementById('refresh-text');
  
  if (refreshIcon) refreshIcon.classList.add('animate-spin-custom');
  if (refreshText) refreshText.textContent = '更新中...';

  try {
    const timestamp = Date.now();
    const staticUrl = `./data/chokepoint_latest.json?_t=${timestamp}`;
    
    // Concurrently fetch static deep ratings and live stock quotes, awaiting both
    const [staticRes] = await Promise.all([
      fetch(staticUrl, { cache: 'no-store' }),
      fetchRealtimeQuotes()
    ]);

    if (!staticRes.ok) {
      throw new Error(`HTTP error loading static data: ${staticRes.status}`);
    }

    currentData = await staticRes.json();
    
    // Re-render UI with merged latest real-time prices & deep ratings
    renderHeaderMetadata(currentData);
    renderCurrentView();

    if (isManual) {
      const etInfo = getUSEasternTimeInfo();
      const statusDesc = etInfo.isOpen ? `美東盤中 ${etInfo.timeString}` : '美股休市定稿';
      showToast(`✅ 12 檔標的即時行情已同步 (${statusDesc})`);
    }
  } catch (error) {
    console.error('Failed to load dashboard data:', error);
    // If static fetch had issues but we have previous data, re-render
    if (currentData) {
      renderHeaderMetadata(currentData);
      renderCurrentView();
    }
    showToast('連線異常，已載入前次快照', true);
  } finally {
    isRefreshing = false;
    if (refreshIcon) refreshIcon.classList.remove('animate-spin-custom');
    if (refreshText) refreshText.textContent = '即時更新';
  }
}

/**
 * Configure automated refresh:
 * - Active during market hours (once per hour = 3600000ms).
 * - Checks status every 5 minutes.
 */
function setupMarketSchedule() {
  if (hourlyIntervalId) {
    clearInterval(hourlyIntervalId);
    hourlyIntervalId = null;
  }

  // Periodic market checker
  setInterval(() => {
    const etInfo = getUSEasternTimeInfo();
    if (etInfo.isOpen && !hourlyIntervalId) {
      hourlyIntervalId = setInterval(() => {
        const check = getUSEasternTimeInfo();
        if (check.isOpen) {
          loadDashboardData(false);
        }
      }, 3600000); // 1 hour
    } else if (!etInfo.isOpen && hourlyIntervalId) {
      clearInterval(hourlyIntervalId);
      hourlyIntervalId = null;
    }
  }, 300000); // Check every 5 minutes

  // Initial setup if currently open
  const initialCheck = getUSEasternTimeInfo();
  if (initialCheck.isOpen) {
    hourlyIntervalId = setInterval(() => {
      const check = getUSEasternTimeInfo();
      if (check.isOpen) {
        loadDashboardData(false);
      }
    }, 3600000);
  }
}

function renderHeaderMetadata(data) {
  const metaTime = document.getElementById('meta-updated-time');
  const quoteTimeTag = document.getElementById('quote-updated-time');
  const versionTag = document.getElementById('version-tag');
  
  if (metaTime && data && data.updated_at_shanghai) {
    metaTime.textContent = data.updated_at_shanghai;
  }

  if (quoteTimeTag) {
    const etInfo = getUSEasternTimeInfo();
    if (etInfo.isOpen) {
      const displayTime = lastESTTime ? `美東 ${lastESTTime}` : `美東 ${etInfo.timeString}`;
      quoteTimeTag.textContent = `${displayTime} (盤中交易中 · 即時報價)`;
      quoteTimeTag.className = 'font-mono text-emerald-400 font-semibold';
    } else {
      quoteTimeTag.textContent = '美股休市 (維持前日收盤定稿)';
      quoteTimeTag.className = 'font-mono text-cyan-400 font-semibold';
    }
  }

  if (versionTag && data && data.version_hash) {
    versionTag.textContent = `Build: ${data.version_hash}`;
  }
}

function getFilteredItems() {
  if (!currentData || !currentData.items) return [];
  const filterSelect = document.getElementById('domain-filter');
  const selectedDomain = filterSelect ? filterSelect.value : 'ALL';

  if (selectedDomain === 'ALL') {
    return currentData.items;
  }
  return currentData.items.filter(item => item.domain_code === selectedDomain);
}

function renderCurrentView() {
  if (currentView === 'cards') {
    renderCardsView();
  } else {
    renderTableView();
  }
}

/**
 * Resolve effective quote:
 * - Prioritize live quote from realtimeQuotes if price exists.
 * - Otherwise fallback to item.baseline_quote.
 */
function getEffectiveQuote(item) {
  if (realtimeQuotes[item.symbol] && realtimeQuotes[item.symbol].price !== '--') {
    return { ...realtimeQuotes[item.symbol], isLive: true };
  }
  if (item.baseline_quote) {
    return { ...item.baseline_quote, isLive: false };
  }
  return null;
}

function renderCardsView() {
  const container = document.getElementById('cards-container');
  const tableContainer = document.getElementById('table-container');
  if (!container) return;

  container.classList.remove('hidden');
  if (tableContainer) tableContainer.classList.add('hidden');

  const items = getFilteredItems();
  container.innerHTML = '';

  const etInfo = getUSEasternTimeInfo();

  items.forEach(item => {
    const card = document.createElement('div');
    card.className = 'bg-[#111827] border border-gray-800/90 hover:border-emerald-500/50 rounded-xl p-5 shadow-lg transition duration-200 flex flex-col justify-between';

    // Retrieve effective quote
    const q = getEffectiveQuote(item);
    let quoteHtml = '';
    if (q && q.price && q.price !== '--') {
      const badgeColor = q.isUp 
        ? 'bg-emerald-950/80 text-emerald-400 border-emerald-800/60' 
        : (q.isDown ? 'bg-rose-950/80 text-rose-400 border-rose-800/60' : 'bg-gray-800 text-gray-300 border-gray-700');
      
      const timeClean = q.time ? (q.time.includes(' ') ? q.time.split(' ')[1] : q.time) : '';
      const marketBadge = (etInfo.isOpen || q.isLive) ? '盤中即時' : '前日收盤';

      quoteHtml = `
        <div class="mt-2.5 px-3 py-2 rounded-lg bg-gray-900/90 border border-gray-800 flex items-center justify-between font-mono">
          <div class="flex items-baseline gap-2">
            <span class="text-[11px] text-gray-400 font-sans">${marketBadge}</span>
            <span class="text-xl font-bold text-white tracking-tight">$${q.price}</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold border ${badgeColor}">
              ${q.changePct}% (${q.changeAmt})
            </span>
            <span class="text-[10px] text-gray-500 hidden sm:inline font-sans">美東 ${timeClean}</span>
          </div>
        </div>
      `;
    } else {
      quoteHtml = `
        <div class="mt-2.5 px-3 py-2 rounded-lg bg-gray-900/60 border border-gray-800/60 flex items-center justify-between text-xs text-gray-400 font-mono">
          <span>行情狀態</span>
          <span class="text-gray-400 text-[11px]">前日收盤基準固定</span>
        </div>
      `;
    }

    // Moat Tier Badge
    const moatBadge = getMoatTierBadge(item.moat_score);

    // 4-Dimension Breakdown Grid
    const dimensions = parseScoreBreakdown(item.score_breakdown);
    const dimensionsHtml = dimensions.map(dim => `
      <div class="bg-gray-950/80 border border-gray-800/80 p-2 rounded-lg flex flex-col justify-between">
        <div class="flex items-center justify-between text-[10px] text-gray-400">
          <span>${dim.title}</span>
          <span class="text-gray-500">${dim.max}分滿</span>
        </div>
        <div class="mt-1 flex items-baseline justify-between font-mono">
          <span class="text-xs font-bold text-emerald-400">${dim.score}</span>
          <span class="text-[10px] text-gray-500">/ ${dim.max}</span>
        </div>
        <div class="w-full bg-gray-800/80 h-1 rounded-full mt-1.5 overflow-hidden">
          <div class="bg-emerald-500 h-full rounded-full transition-all duration-500" style="width: ${dim.pct}%"></div>
        </div>
      </div>
    `).join('');

    card.innerHTML = `
      <div>
        <!-- Card Top Bar: Symbol, Name, Moat Score -->
        <div class="flex items-start justify-between gap-2 pb-3 border-b border-gray-800/80">
          <div>
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-mono font-bold text-lg text-white">${item.symbol}</span>
              <span class="text-xs text-gray-300 font-medium">${item.company_name}</span>
              <span class="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 font-mono">${item.market}</span>
            </div>
            <p class="text-xs text-emerald-400 font-medium mt-1 leading-snug">${item.chokepoint_position}</p>
          </div>
          <div class="text-right shrink-0">
            <span class="text-2xl font-black font-mono text-emerald-400">${item.moat_score}</span>
            <span class="text-[10px] text-gray-400 block -mt-1 font-mono">護城河總分</span>
          </div>
        </div>

        <!-- Price Quote Bar -->
        ${quoteHtml}

        <!-- Moat Tier & Four-Dimension Breakdown Panel -->
        <div class="mt-3">
          <div class="flex items-center justify-between text-[11px] mb-1.5">
            <span class="text-gray-400 font-medium flex items-center gap-1.5">
              <span>護城河量化評級</span>
              <span class="text-[10px] px-1.5 py-0.5 rounded border ${moatBadge.color}">${moatBadge.text}</span>
            </span>
            <span class="text-[10px] text-emerald-500 font-mono">${item.data_status}</span>
          </div>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            ${dimensionsHtml}
          </div>
        </div>

        <!-- Chokepoint Domain & Rationale -->
        <div class="mt-3.5 space-y-2.5 text-xs">
          <div>
            <span class="text-gray-500 font-semibold block text-[11px]">卡脖子領域定位：</span>
            <span class="text-gray-200">${item.chokepoint_domain}</span>
          </div>
          <div>
            <span class="text-gray-500 font-semibold block text-[11px]">打分深度裁決：</span>
            <span class="text-gray-300 leading-relaxed">${item.score_rationale}</span>
          </div>
          <div>
            <span class="text-gray-500 font-semibold block text-[11px]">核心護城河壁壘：</span>
            <span class="text-gray-300 leading-relaxed">${item.core_moat_points}</span>
          </div>
          <div>
            <span class="text-gray-500 font-semibold block text-[11px]">運營與產能瓶頸：</span>
            <span class="text-amber-400/90 leading-relaxed">${item.operational_bottleneck}</span>
          </div>
        </div>
      </div>

      <!-- Card Footer: Status & Position -->
      <div class="mt-4 pt-3 border-t border-gray-800/80 flex items-center justify-between text-[11px] text-gray-400">
        <div>
          <span>建議買入位：<b class="text-gray-300">${item.buy_position}</b></span>
          <span class="mx-1.5 text-gray-700">|</span>
          <span>市場持倉：<b class="text-gray-300">${item.holding_position}</b></span>
        </div>
        <span class="text-[10px] text-gray-500">純客觀質詢 · 不作薦股</span>
      </div>
    `;

    container.appendChild(card);
  });
}

function renderTableView() {
  const container = document.getElementById('cards-container');
  const tableContainer = document.getElementById('table-container');
  const tbody = document.getElementById('table-body');
  if (!tbody || !tableContainer) return;

  if (container) container.classList.add('hidden');
  tableContainer.classList.remove('hidden');

  const items = getFilteredItems();
  tbody.innerHTML = '';

  const etInfo = getUSEasternTimeInfo();

  items.forEach(item => {
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-gray-800/40 transition duration-150';

    const q = getEffectiveQuote(item);
    let priceCellHtml = '';
    if (q && q.price && q.price !== '--') {
      const textColor = q.isUp ? 'text-emerald-400' : (q.isDown ? 'text-rose-400' : 'text-gray-300');
      const timeClean = q.time ? (q.time.includes(' ') ? q.time.split(' ')[1] : q.time) : '';
      priceCellHtml = `
        <div class="font-bold text-white text-sm">$${q.price}</div>
        <div class="text-[11px] font-medium ${textColor}">
          ${q.changePct}% (${q.changeAmt})
        </div>
        <div class="text-[10px] text-gray-500 font-mono mt-0.5">${(etInfo.isOpen || q.isLive) ? '盤中' : '收盤'} ${timeClean}</div>
      `;
    } else {
      priceCellHtml = `<span class="text-gray-500 text-xs">前日收盤基準</span>`;
    }

    tr.innerHTML = `
      <td class="py-3 px-3.5 font-medium whitespace-nowrap">
        <div class="flex items-center gap-1.5">
          <span class="font-mono font-bold text-white">${item.symbol}</span>
          <span class="text-[11px] font-mono text-emerald-400 font-bold bg-emerald-950/80 px-1.5 py-0.5 rounded border border-emerald-800/50">${item.moat_score}分</span>
        </div>
        <div class="text-[10px] text-gray-400 truncate max-w-[120px] mt-0.5">${item.company_name}</div>
        <div class="text-[10px] text-gray-500 font-mono mt-1">${item.score_breakdown}</div>
      </td>
      <td class="py-3 px-3 text-gray-200 text-xs max-w-[200px] leading-snug">
        ${item.chokepoint_domain}
      </td>
      <td class="py-3 px-3 font-mono whitespace-nowrap">
        ${priceCellHtml}
      </td>
      <td class="py-3 px-3 text-[11px] text-gray-300 max-w-[160px] leading-snug">
        ${item.institutional_flow}
      </td>
      <td class="py-3 px-3 text-[11px] text-emerald-400 max-w-[140px] leading-snug font-medium">
        ${item.capital_flow}
      </td>
      <td class="py-3 px-3.5 text-[11px] text-gray-300 max-w-[180px] leading-snug">
        ${item.financial_profit}
      </td>
      <td class="py-3 px-3.5 text-[11px] text-amber-300/90 max-w-[200px] leading-snug">
        ${item.operational_bottleneck}
      </td>
      <td class="py-3 px-3 text-[11px] text-gray-400 whitespace-nowrap">
        買入: <b class="text-gray-300">${item.buy_position}</b><br>
        持倉: <b class="text-gray-300">${item.holding_position}</b>
      </td>
    `;

    tbody.appendChild(tr);
  });
}

function showToast(message, isError = false) {
  const toast = document.getElementById('toast');
  const toastMessage = document.getElementById('toast-message');
  if (!toast || !toastMessage) return;

  toastMessage.textContent = message;
  if (isError) {
    toast.className = toast.className.replace('bg-emerald-900 border-emerald-700', 'bg-rose-900 border-rose-700');
  } else {
    toast.className = toast.className.replace('bg-rose-900 border-rose-700', 'bg-emerald-900 border-emerald-700');
  }

  toast.classList.remove('translate-y-20', 'opacity-0');
  setTimeout(() => {
    toast.classList.add('translate-y-20', 'opacity-0');
  }, 2500);
}

// Global App Initialization
function initApp() {
  // 1. Immediate initial data & live quote load
  loadDashboardData(false);

  // 2. Setup market-aware smart refresh schedule
  setupMarketSchedule();

  // 3. Refresh button click with concurrency lock
  const refreshBtn = document.getElementById('refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      loadDashboardData(true);
    });
  }

  // 4. Domain filter
  const domainFilter = document.getElementById('domain-filter');
  if (domainFilter) {
    domainFilter.addEventListener('change', renderCurrentView);
  }

  // 5. View switch buttons
  const viewCardBtn = document.getElementById('view-card-btn');
  const viewTableBtn = document.getElementById('view-table-btn');

  if (viewCardBtn && viewTableBtn) {
    viewCardBtn.addEventListener('click', () => {
      currentView = 'cards';
      viewCardBtn.className = 'px-2.5 py-1 rounded font-medium bg-emerald-600 text-white shadow-sm transition';
      viewTableBtn.className = 'px-2.5 py-1 rounded font-medium text-gray-300 hover:text-white transition';
      renderCurrentView();
    });

    viewTableBtn.addEventListener('click', () => {
      currentView = 'table';
      viewTableBtn.className = 'px-2.5 py-1 rounded font-medium bg-emerald-600 text-white shadow-sm transition';
      viewCardBtn.className = 'px-2.5 py-1 rounded font-medium text-gray-300 hover:text-white transition';
      renderCurrentView();
    });
  }
}

// Support all browser ready states
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
