/**
 * US Chokepoint Dashboard - Frontend Application
 * High Information Density, Native ESModule, Zero Overhead
 * Enforces Cache Busting on every request & update.
 */

let currentData = null;
let currentView = 'cards'; // 'cards' | 'table'

// Domain classification map for quick filtering
const DOMAIN_GROUPS = {
  CHIP: ['NVDA', 'AVGO'],
  EQUIP: ['ASML', 'LRCX', 'AMAT'],
  MEMORY: ['MU'],
  POWER: ['GEV', 'ETN', 'VRT', 'APH']
};

/**
 * Fetch latest data with aggressive cache busting.
 */
async function loadDashboardData() {
  const refreshIcon = document.getElementById('refresh-icon');
  const refreshText = document.getElementById('refresh-text');
  
  if (refreshIcon) refreshIcon.classList.add('animate-spin-custom');
  if (refreshText) refreshText.textContent = '載入中...';

  try {
    const timestamp = Date.now();
    const url = `./data/chokepoint_latest.json?_t=${timestamp}`;
    
    const response = await fetch(url, {
      cache: 'no-store',
      headers: {
        'Pragma': 'no-cache',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    currentData = await response.json();
    renderHeaderMetadata(currentData);
    renderCurrentView();
    showToast('看板數據已即時同步至最新版本');
  } catch (error) {
    console.error('Failed to load dashboard data:', error);
    showToast('連線失敗，請稍後重試', true);
  } finally {
    if (refreshIcon) refreshIcon.classList.remove('animate-spin-custom');
    if (refreshText) refreshText.textContent = '即時更新';
  }
}

function renderHeaderMetadata(data) {
  const metaTime = document.getElementById('meta-updated-time');
  const versionTag = document.getElementById('version-tag');
  
  if (metaTime && data.updated_at_shanghai) {
    metaTime.textContent = data.updated_at_shanghai;
  }
  if (versionTag && data.version_hash) {
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
      <td class="py-3 px-3 font-mono text-xs text-gray-300 whitespace-nowrap">
        ${item.market}
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
    toast.className = toast.className.replace('bg-emerald-900 border-emerald-700', 'bg-red-900 border-red-700');
  } else {
    toast.className = toast.className.replace('bg-red-900 border-red-700', 'bg-emerald-900 border-emerald-700');
  }

  toast.classList.remove('translate-y-20', 'opacity-0');
  setTimeout(() => {
    toast.classList.add('translate-y-20', 'opacity-0');
  }, 2500);
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
  // Load initial data
  loadDashboardData();

  // Refresh button
  const refreshBtn = document.getElementById('refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', loadDashboardData);
  }

  // Domain filter
  const domainFilter = document.getElementById('domain-filter');
  if (domainFilter) {
    domainFilter.addEventListener('change', renderCurrentView);
  }

  // View switch buttons
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
});
