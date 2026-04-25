import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeManifest } from './runtime-manifest.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_PATH =
  process.env.AEMCP_SESSION_STATE_PATH ??
  path.resolve(__dirname, '..', '..', '..', '..', 'runtime', 'manifests', 'session_state.json');

let _mode: 'active' | 'idle' | 'disconnected' = 'disconnected',
    _startedAt: string | null = null,
    _lastCmd: string | null = null,
    _count = 0,
    _panelPid: number | null = null,
    _idle: ReturnType<typeof setTimeout> | null = null;

function _write(): void {
  writeManifest(STATE_PATH, {
    schema_version: 1, session_owner: null, mode: _mode,
    started_at: _startedAt, last_command: _lastCmd,
    command_count: _count, panel_pid: _panelPid, server_pid: process.pid,
  });
}

export function initSession(): void { _write(); }

export function onPanelConnect(pid: number | null): void {
  _startedAt = new Date().toISOString(); _count = 0; _panelPid = pid; _mode = 'active';
  _write();
}

export function onPanelDisconnect(): void {
  if (_idle) { clearTimeout(_idle); _idle = null; }
  _mode = 'disconnected'; _panelPid = null; _write();
}

export function recordCommand(name: string): void {
  _lastCmd = name; _count++; _mode = 'active'; _write();
  if (_idle) clearTimeout(_idle);
  _idle = setTimeout(() => { _mode = 'idle'; _write(); _idle = null; }, 30_000);
  (_idle as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
}

export function shutdown(): { command_count: number; duration_s: number } {
  if (_idle) { clearTimeout(_idle); _idle = null; }
  const duration_s = _startedAt
    ? Math.round((Date.now() - new Date(_startedAt).getTime()) / 1000) : 0;
  _mode = 'disconnected'; _write();
  return { command_count: _count, duration_s };
}
