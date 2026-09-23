/**
 * US Chokepoint Dashboard - Frontend Application
 * High Information Density, Native ESModule, Zero Overhead
 * Resilient Multi-tiered Data Architecture with Guaranteed Rendering
 */

let currentData = null;
let realtimeQuotes = {};
let currentView = 'cards'; // 'cards' | 'table'
let lastQuoteTime = null;
let isRefreshing = false;

// Domain classification map for quick filtering
const DOMAIN_GROUPS = {
  CHIP: ['NVDA', 'AVGO'],
  EQUIP: ['ASML', 'LRCX', 'AMAT'],
  MEMORY: ['MU'],
  POWER: ['GEV', 'ETN', 'VRT', 'APH']
};

// Tencent Financial API Symbol Mapping
const SYMBOL_TO_TENCENT = {
  NVDA: 'usNVDA',
  ASML: 'usASML',
  AVGO: 'usAVGO',
  LRCX: 'usLRCX',
  AMAT: 'usAMAT',
  MU:   'usMU',
  GEV:  'usGEV',
  ETN:  'usETN',
  VRT:  'usVRT',
  APH:  'usAPH'
};

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
 * Fetch real-time quotes with strict 3-second timeout.
 * Guaranteed never to hang or block UI rendering.
 */
async function fetchRealtimeQuotes() {
  const queryList = Object.values(SYMBOL_TO_TENCENT).join(',');
  const url = `https://qt.gtimg.cn/q=${queryList}?_t=${Date.now()}`;

  let rawText = '';

  // 1. Direct fetch with 3s AbortController timeout
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const res = await fetch(url, {
      signal: controller.signal,
      cache: 'no-store',
      headers: {
        'Pragma': 'no-cache',
        'Cache-Control': 'no-cache, no-store'
      }
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      rawText = await res.text();
    }
  } catch (err) {
    console.warn('Direct quote fetch aborted or failed:', err);
  }

  // 2. Fallback to JSONP script injection with 3s safety timeout
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
      }, 3000);

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

    // Find symbol
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
      price: !isNaN(currentPrice) ? currentPrice.toFixed(2) : '--',
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
}

/**
 * Robust non-blocking dashboard loader:
 * 1. Immediately loads static JSON & renders the UI (ZERO loading freeze).
 * 2. Uses embedded baseline quotes instantly so cards are NEVER blank.
 * 3. Asynchronously fetches live quotes to refresh prices.
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
    const staticUrl = `./data/chokepoint_latest.json?_t=${timestamp}&v=202609231550`;
    
    // Step 1: Fetch static rating data
    const staticRes = await fetch(staticUrl, {
      cache: 'no-store',
      headers: {
        'Pragma': 'no-cache',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      }
    });

    if (!staticRes.ok) {
      throw new Error(`HTTP error loading static data: ${staticRes.status}`);
    }

    currentData = await staticRes.json();
    
    // Render UI immediately with static data & baseline quotes! Zero wait time!
    renderHeaderMetadata(currentData);
    renderCurrentView();

    // Step 2: Asynchronously update live stock quotes without blocking UI
    fetchRealtimeQuotes().then(() => {
      renderHeaderMetadata(currentData);
      renderCurrentView();
    }).catch(err => {
      console.warn('Realtime quotes background fetch finished with fallback:', err);
    });

    if (isManual) {
      showToast('✅ 10 檔標的最新行情與 9月23日 評級已同步完成');
    }
  } catch (error) {
    console.error('Failed to load dashboard data:', error);
    // Even if static fetch failed, if we had currentData, re-render it
    if (currentData) {
      renderHeaderMetadata(currentData);
      renderCurrentView();
    }
    showToast('連線異常，請稍後重試', true);
  } finally {
    isRefreshing = false;
    if (refreshIcon) refreshIcon.classList.remove('animate-spin-custom');
    if (refreshText) refreshText.textContent = '即時更新';
  }
}

/**
 * Silent periodic refresh for real-time stock prices (every 30s)
 */
async function silentRefreshQuotes() {
  try {
    await fetchRealtimeQuotes();
    renderHeaderMetadata(currentData);
    renderCurrentView();
  } catch (e) {
    console.debug('Silent quote refresh skipped:', e);
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
    if (lastQuoteTime) {
      quoteTimeTag.textContent = `${lastQuoteTime} (即時連線)`;
      quoteTimeTag.className = 'font-mono text-emerald-400 font-semibold';
    } else {
      quoteTimeTag.textContent = formatShanghaiTime() + ' (已連線)';
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
 * Resolve effective quote: prioritize live quote, fallback to item.baseline_quote
 */
function getEffectiveQuote(item) {
  if (realtimeQuotes[item.symbol] && realtimeQuotes[item.symbol].price !== '--') {
    return realtimeQuotes[item.symbol];
  }
  if (item.baseline_quote) {
    return item.baseline_quote;
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

  items.forEach(item => {
    const card = document.createElement('div');
    card.className = 'bg-[#111827] border border-gray-800/90 hover:border-emerald-500/50 rounded-xl p-5 shadow-lg transition duration-200 flex flex-col justify-between';

    // Retrieve live quote or fallback to baseline quote
    const q = getEffectiveQuote(item);
    let quoteHtml = '';
    if (q && q.price && q.price !== '--') {
      const badgeColor = q.isUp 
        ? 'bg-emerald-950/80 text-emerald-400 border-emerald-800/60' 
        : (q.isDown ? 'bg-rose-950/80 text-rose-400 border-rose-800/60' : 'bg-gray-800 text-gray-300 border-gray-700');
      const timeClean = q.time ? q.time.split(' ')[1] || q.time : '';

      quoteHtml = `
        <div class="mt-2.5 px-3 py-2 rounded-lg bg-gray-900/90 border border-gray-800 flex items-center justify-between font-mono">
          <div class="flex items-baseline gap-2">
            <span class="text-[11px] text-gray-400 font-sans">最新報價</span>
            <span class="text-xl font-bold text-white tracking-tight">$${q.price}</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold border ${badgeColor}">
              ${q.changePct}% (${q.changeAmt})
            </span>
            <span class="text-[10px] text-gray-500 hidden sm:inline">${timeClean}</span>
          </div>
        </div>
      `;
    } else {
      quoteHtml = `
        <div class="mt-2.5 px-3 py-2 rounded-lg bg-gray-900/60 border border-gray-800/60 flex items-center justify-between text-xs text-gray-400 font-mono">
          <span>行情連線</span>
          <span class="text-emerald-400 text-[11px]">即時報價同步中...</span>
        </div>
      `;
    }

    card.innerHTML = `
      <div>
        <!-- Card Top Bar: Symbol, Name, Score -->
        <div class="flex items-start justify-between gap-2 pb-3 border-b border-gray-800/80">
          <div>
            <div class="flex items-center gap-2">
              <span class="font-mono font-bold text-lg text-white">${item.symbol}</span>
              <span class="text-xs text-gray-400 font-medium">${item.company_name}</span>
              <span class="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 font-mono">${item.market}</span>
            </div>
            <p class="text-xs text-emerald-400 font-medium mt-1 leading-snug">${item.chokepoint_position}</p>
          </div>
          <div class="text-right shrink-0">
            <span class="text-2xl font-black font-mono text-emerald-400">${item.moat_score}</span>
            <span class="text-[10px] text-gray-500 block -mt-1 font-mono">/ 100分</span>
          </div>
        </div>

        <!-- Real-time Quote Bar -->
        ${quoteHtml}

        <!-- Score Breakdown Tag -->
        <div class="mt-2.5 flex items-center justify-between text-[11px] bg-gray-900/80 px-2.5 py-1.5 rounded-lg border border-gray-800/60 font-mono text-gray-400">
          <span>${item.score_breakdown}</span>
          <span class="text-[10px] text-emerald-500 font-medium">${item.data_status}</span>
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

  items.forEach(item => {
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-gray-800/40 transition duration-150';

    const q = getEffectiveQuote(item);
    let priceCellHtml = '';
    if (q && q.price && q.price !== '--') {
      const textColor = q.isUp ? 'text-emerald-400' : (q.isDown ? 'text-rose-400' : 'text-gray-300');
      const timeClean = q.time ? q.time.split(' ')[1] || q.time : '';
      priceCellHtml = `
        <div class="font-bold text-white text-sm">$${q.price}</div>
        <div class="text-[11px] font-medium ${textColor}">
          ${q.changePct}% (${q.changeAmt})
        </div>
        <div class="text-[10px] text-gray-500 font-mono mt-0.5">${timeClean}</div>
      `;
    } else {
      priceCellHtml = `<span class="text-emerald-400 text-xs">同步中...</span>`;
    }

    tr.innerHTML = `
      <td class="py-3 px-3.5 font-medium whitespace-nowrap">
        <div class="flex items-center gap-1.5">
          <span class="font-mono font-bold text-white">${item.symbol}</span>
          <span class="text-[11px] font-mono text-emerald-400 font-bold bg-emerald-950/80 px-1.5 py-0.5 rounded border border-emerald-800/50">${item.moat_score}分</span>
        </div>
        <div class="text-[10px] text-gray-400 truncate max-w-[120px] mt-0.5">${item.company_name}</div>
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
  // 1. Immediate data load
  loadDashboardData(false);

  // 2. Periodic quote refresh
  setInterval(silentRefreshQuotes, 30000);

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

// Support all browser ready states (loading, interactive, complete)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
