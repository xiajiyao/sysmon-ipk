#!/usr/bin/env python3
"""OpenWrt System Monitor - Flask Backend"""

import os
import json
import glob
import time
import random
import subprocess
import threading
from flask import Flask, jsonify, send_from_directory

PORT = int(os.environ.get('SYSMON_PORT', '8999'))
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'static')

app = Flask(__name__, static_folder=STATIC_DIR)

# --- Helpers ---

def read_file(path):
    try:
        with open(path) as f:
            return f.read()
    except Exception:
        return ''

def run_cmd(cmd, timeout=4):
    try:
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
        return r.stdout.strip()
    except Exception:
        return ''

def safe_int(value, default=0):
    try:
        return int(str(value).strip())
    except Exception:
        return default

# --- CPU (with delta tracking) ---

_prev_cpu = {'idle': 0, 'total': 0}

def get_cpu():
    global _prev_cpu
    line = read_file('/proc/stat').split('\n')[0]
    parts = list(map(int, line.split()[1:]))
    idle = parts[3] + (parts[4] if len(parts) > 4 else 0)
    total = sum(parts)

    d_idle = idle - _prev_cpu['idle']
    d_total = total - _prev_cpu['total']
    _prev_cpu = {'idle': idle, 'total': total}

    usage = round((1 - d_idle / d_total) * 100) if d_total > 0 else 0

    temp = 0
    for i in range(8):
        raw = read_file(f'/sys/class/thermal/thermal_zone{i}/temp').strip()
        if raw:
            parsed = safe_int(raw, None)
            if parsed is not None:
                temp = round(parsed / 1000)
                break

    load_parts = read_file('/proc/loadavg').strip().split()
    load = [float(load_parts[i]) for i in range(3)] if len(load_parts) >= 3 else [0, 0, 0]

    return {'usage': usage, 'temp': temp, 'load': load}

# --- Memory ---

def get_memory():
    info = {}
    for line in read_file('/proc/meminfo').split('\n'):
        parts = line.split()
        if len(parts) >= 2:
            info[parts[0].rstrip(':')] = int(parts[1])
    to_gb = lambda kb: round(kb / 1024 / 1024, 1)
    total = info.get('MemTotal', 0)
    free = info.get('MemFree', 0)
    buffers = info.get('Buffers', 0)
    cached = info.get('Cached', 0)
    return {
        'total': to_gb(total),
        'used': to_gb(total - free - buffers - cached),
        'buffers': to_gb(buffers),
        'cache': to_gb(cached),
    }

# --- Storage ---

def get_storage():
    system = data = total = 0
    for line in run_cmd('df -k', timeout=2).split('\n')[1:]:
        p = line.split()
        if len(p) < 6:
            continue
        used_gb = round(int(p[2]) / 1024 / 1024, 1)
        total_gb = round(int(p[1]) / 1024 / 1024, 1)
        if p[5] == '/':
            system, total = used_gb, total_gb
        elif p[5] == '/data':
            data = used_gb
    return {'system': system, 'data': data, 'total': total, 'readIops': 0, 'writeIops': 0, 'health': 'OK'}

# --- Network (with delta tracking) ---

def _parse_net_dev():
    result = {}
    for line in read_file('/proc/net/dev').strip().split('\n')[2:]:
        parts = line.strip().split()
        iface = parts[0].rstrip(':')
        result[iface] = {'rx': int(parts[1]), 'tx': int(parts[9])}
    return result

_prev_net = _parse_net_dev()
_prev_net_time = time.time()

def get_network():
    global _prev_net, _prev_net_time
    now = time.time()
    curr = _parse_net_dev()
    dt = max(now - _prev_net_time, 0.1)

    rx_bytes = tx_bytes = 0
    for iface, vals in curr.items():
        if iface == 'lo':
            continue
        prev = _prev_net.get(iface, {'rx': 0, 'tx': 0})
        rx_bytes += max(0, vals['rx'] - prev['rx'])
        tx_bytes += max(0, vals['tx'] - prev['tx'])

    _prev_net = curr
    _prev_net_time = now

    to_mbps = lambda b: round(b / dt / 1024 / 1024, 2)

    active_conns = 0
    for line in read_file('/proc/net/sockstat').split('\n'):
        if line.startswith('TCP:'):
            parts = line.split()
            if 'inuse' in parts:
                idx = parts.index('inuse')
                active_conns = safe_int(parts[idx + 1], 0) if idx + 1 < len(parts) else 0
            break

    return {'up': to_mbps(tx_bytes), 'down': to_mbps(rx_bytes), 'activeConns': active_conns, 'history': [0] * 20}

# --- Docker (background cache) ---

_docker_cache = []
_docker_lock = threading.Lock()

def _refresh_docker():
    global _docker_cache
    try:
        fmt = '{"id":"{{.ID}}","name":"{{.Names}}","image":"{{.Image}}","status":"{{.Status}}","ports":"{{.Ports}}"}'
        out = run_cmd(f"docker ps --format '{fmt}'", timeout=4)
        if not out:
            with _docker_lock:
                _docker_cache = []
            return
        containers = []
        for line in out.split('\n'):
            if not line.strip():
                continue
            c = json.loads(line)
            cpu, mem = 0, '0MB'
            try:
                s = run_cmd(f"docker stats --no-stream --format '{{{{.CPUPerc}}}},{{{{.MemUsage}}}}' {c['id']}", timeout=3)
                if s:
                    parts = s.split(',')
                    cpu = float(parts[0].replace('%', '')) if parts[0] else 0
                    mem = parts[1].split('/')[0].strip() if len(parts) > 1 else '0MB'
            except Exception:
                pass
            c['cpu'] = cpu
            c['mem'] = mem
            c['uptime'] = c['status']
            containers.append(c)
        with _docker_lock:
            _docker_cache = containers
    except Exception:
        with _docker_lock:
            _docker_cache = []

def _docker_loop():
    while True:
        _refresh_docker()
        time.sleep(5)

threading.Thread(target=_docker_loop, daemon=True).start()

# --- Thermal / Fan (新增) ---

def get_thermal():
    zones = []
    for path in sorted(glob.glob('/sys/class/thermal/thermal_zone*')):
        name = read_file(os.path.join(path, 'type')).strip() or os.path.basename(path)
        raw = read_file(os.path.join(path, 'temp')).strip()
        parsed = safe_int(raw, None)
        temp = round(parsed / 1000, 1) if parsed is not None else 0
        zones.append({'name': name, 'temp': temp})

    fans = []
    for hwmon in sorted(glob.glob('/sys/class/hwmon/hwmon*')):
        for fan_path in sorted(glob.glob(os.path.join(hwmon, 'fan*_input'))):
            raw = read_file(fan_path).strip()
            rpm = safe_int(raw, 0)
            label_path = fan_path.replace('_input', '_label')
            label = read_file(label_path).strip() or os.path.basename(fan_path).replace('_input', '')
            fans.append({'name': label, 'rpm': rpm})

    return {'zones': zones, 'fans': fans}

# --- System Services (新增) ---

_IMPORTANT_SERVICES = [
    'dnsmasq', 'firewall', 'network', 'dropbear', 'uhttpd',
    'odhcpd', 'sysntpd', 'cron', 'log', 'dockerd', 'sysmon'
]

def get_services():
    services = []
    for name in _IMPORTANT_SERVICES:
        init_path = f'/etc/init.d/{name}'
        if not os.path.exists(init_path):
            continue
        enabled = os.path.exists(f'/etc/rc.d/S*{name}') or \
                  len(glob.glob(f'/etc/rc.d/S??{name}')) > 0
        running = run_cmd(f'/etc/init.d/{name} status 2>/dev/null; echo $?', timeout=2)
        is_running = running.strip().endswith('0') if running else False
        if not is_running:
            pid_check = run_cmd(f'pgrep -x {name} >/dev/null 2>&1; echo $?', timeout=2)
            is_running = pid_check.strip() == '0'
        services.append({
            'name': name,
            'enabled': enabled,
            'running': is_running,
        })
    return services

# --- Collect all stats ---

def collect_stats():
    with _docker_lock:
        docker = list(_docker_cache)
    return {
        'cpu': get_cpu(),
        'memory': get_memory(),
        'storage': get_storage(),
        'network': get_network(),
        'docker': docker,
        'thermal': get_thermal(),
        'services': get_services(),
        'binaryNoise': ''.join(str(random.randint(0, 1)) for _ in range(8)),
        'uptime': int(float(read_file('/proc/uptime').split()[0])) if read_file('/proc/uptime') else 0,
    }

# --- Routes ---

@app.route('/api/stats')
def api_stats():
    try:
        return jsonify(collect_stats())
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/')
def index():
    return send_from_directory(STATIC_DIR, 'index.html')

@app.route('/<path:path>')
def static_files(path):
    return send_from_directory(STATIC_DIR, path)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=PORT, debug=False)
