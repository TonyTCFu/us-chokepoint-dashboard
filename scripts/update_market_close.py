#!/usr/bin/env python3
"""
Automated Daily Market Close Sync Script for US Chokepoint Dashboard.
Fetches official closing quotes from Tencent Financial API and updates:
1. data/chokepoint_latest.json (baseline quotes, timestamps, version hash)
2. index.html (cache breaker BUILD_VERSION and script query param)
"""

import urllib.request
import json
import datetime
import re
import os
import sys

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_PATH = os.path.join(BASE_DIR, 'data', 'chokepoint_latest.json')
INDEX_PATH = os.path.join(BASE_DIR, 'index.html')

SYMBOLS = {
    'TSM':  'usTSM',
    'NVDA': 'usNVDA',
    'ASML': 'usASML',
    'AVGO': 'usAVGO',
    'SKHY': 'usSKHY',
    'LRCX': 'usLRCX',
    'AMAT': 'usAMAT',
    'MU':   'usMU',
    'GEV':  'usGEV',
    'ETN':  'usETN',
    'VRT':  'usVRT',
    'APH':  'usAPH'
}

def fetch_quotes():
    query_str = ','.join(SYMBOLS.values())
    url = f"https://qt.gtimg.cn/q={query_str}&_t={int(datetime.datetime.now().timestamp()*1000)}"
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
    
    with urllib.request.urlopen(req, timeout=10) as resp:
        content = resp.read().decode('gbk', errors='ignore')
        
    lines = [l.strip() for l in content.split(';') if l.strip()]
    quotes = {}
    sample_time = ""

    for line in lines:
        m = re.match(r'^v_(us[A-Za-z0-9]+)=\"(.+)\"$', line)
        if not m:
            continue
        k, payload = m.groups()
        fields = payload.split('~')
        matching_syms = [s for s, tk in SYMBOLS.items() if tk == k]
        if not matching_syms:
            continue
        sym = matching_syms[0]
        
        price = float(fields[3])
        prev_close = float(fields[4])
        time_str = fields[30]
        change_amt = float(fields[31])
        change_pct = float(fields[32])
        
        if time_str and not sample_time:
            sample_time = time_str
            
        quotes[sym] = {
            'price': f'{price:.2f}',
            'prevClose': f'{prev_close:.2f}',
            'changeAmt': f'+{change_amt:.2f}' if change_amt > 0 else f'{change_amt:.2f}',
            'changePct': f'+{change_pct:.2f}' if change_pct > 0 else f'{change_pct:.2f}',
            'time': time_str,
            'isUp': change_pct > 0,
            'isDown': change_pct < 0
        }
        
    return quotes, sample_time

def main():
    print(f"Starting market close sync at {datetime.datetime.now()}...")
    quotes, sample_time = fetch_quotes()
    if len(quotes) < len(SYMBOLS):
        print(f"Warning: Only fetched {len(quotes)}/{len(SYMBOLS)} quotes.", file=sys.stderr)
        if not quotes:
            print("Error: No quotes fetched. Aborting.", file=sys.stderr)
            sys.exit(1)

    now = datetime.datetime.now()
    now_shanghai_str = now.strftime('%Y-%m-%d %H:%M:%S')
    version_hash = now.strftime('%Y%m%d_%H%M')

    # Parse market close date from sample_time (e.g. "2026-09-23 16:08:05")
    market_date_str = ""
    if sample_time and ' ' in sample_time:
        m_date = sample_time.split(' ')[0].replace('-', '/')
        m_date_short = '/'.join(m_date.split('/')[1:])
        market_date_str = f"美股{m_date_short}收盤定稿"
    else:
        market_date_str = "美股收盤定稿"

    # 1. Update data/chokepoint_latest.json
    if os.path.exists(DATA_PATH):
        with open(DATA_PATH, 'r', encoding='utf-8') as f:
            data = json.load(f)

        # Check if quotes actually changed
        has_change = False
        for item in data.get('items', []):
            sym = item.get('symbol')
            old_q = item.get('baseline_quote')
            new_q = quotes.get(sym)
            if not old_q or not new_q or old_q.get('price') != new_q.get('price') or old_q.get('time') != new_q.get('time'):
                has_change = True
                break

        if not has_change:
            print("All 12 quotes are identical to existing baseline. No redundant update needed.")
            return

        data['version_hash'] = version_hash.replace('_', '')
        data['updated_at_utc'] = datetime.datetime.utcnow().isoformat() + 'Z'
        data['updated_at_shanghai'] = f"{now_shanghai_str} (UTC+8 {market_date_str})"

        for item in data.get('items', []):
            sym = item.get('symbol')
            if sym in quotes:
                item['baseline_quote'] = quotes[sym]

        with open(DATA_PATH, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"Successfully updated {DATA_PATH}")

    # 2. Update index.html cache breaker
    if os.path.exists(INDEX_PATH):
        with open(INDEX_PATH, 'r', encoding='utf-8') as f:
            html = f.read()

        html = re.sub(
            r'const BUILD_VERSION = "[^"]+";',
            f'const BUILD_VERSION = "{version_hash}";',
            html
        )
        html = re.sub(
            r'src="\./app\.js\?v=[^"]+"',
            f'src="./app.js?v={version_hash.replace("_", "")}"',
            html
        )

        with open(INDEX_PATH, 'w', encoding='utf-8') as f:
            f.write(html)
        print(f"Successfully updated {INDEX_PATH} with version {version_hash}")

    print("Daily market close update completed successfully.")

if __name__ == '__main__':
    main()
