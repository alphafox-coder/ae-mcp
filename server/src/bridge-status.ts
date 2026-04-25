/**
 * bridge-status.ts
 * Writer for runtime/manifests/bridge_status.json per ADR-0006.
 *
 * Single writer: vendor/ae-mcp/server/src/index.ts (via this module).
 * Schema: v1 (9 fields). Atomic rename via fs.renameSync — ADR-0006 Rule 1.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeManifest, type ManifestData } from './runtime-manifest.js';

// ESM: __dirname polyfill (not available natively in ESM modules)
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Path resolution: 4 levels up from server/build/ → repo root → runtime/manifests/
// Fallback to AEMCP_BRIDGE_STATUS_PATH env for standalone / non-standard layouts.
const bridgeStatusPath =
  process.env.AEMCP_BRIDGE_STATUS_PATH ??
  path.resolve(__dirname, '..', '..', '..', '..', 'runtime', 'manifests', 'bridge_status.json');

/** ADR-0006 Schema v1 */
export interface BridgeStatus {
  schema_version: 1;
  updated_at: string;       // ISO 8601 UTC, e.g. "2026-04-23T18:00:00.000Z"
  mcp: 'after-effects-alpha-depth';
  panel: 'AEMCP';
  connected: boolean;
  health: 'healthy' | 'degraded' | 'unknown';
  session_owner: string | null;
  server_pid: number;
  server_port: number;
}

let _serverPort = 0;
let _heartbeatTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Must be called once after the WebSocket server binds,
 * before any writeBridgeStatus() call.
 */
export function initBridgeStatusWriter(port: number): void {
  _serverPort = port;
}

/**
 * Writes bridge_status.json atomically per ADR-0006.
 * Uses fs.renameSync (sync) — NOT fs.rename async or fs.promises.rename.
 * NTFS atomic-rename semantics require the sync variant (ADR-0006 Rule 1).
 */
export function writeBridgeStatus(
  state: Partial<Pick<BridgeStatus, 'connected' | 'health' | 'session_owner'>>
): void {
  const payload: BridgeStatus = {
    schema_version: 1,
    updated_at: new Date().toISOString(),
    mcp: 'after-effects-alpha-depth',
    panel: 'AEMCP',
    connected: state.connected ?? false,
    health: state.health ?? 'unknown',
    session_owner: state.session_owner ?? null,
    server_pid: process.pid,
    server_port: _serverPort,
  };

  writeManifest(bridgeStatusPath, payload as unknown as ManifestData);
}

/**
 * Start 10-second heartbeat (ADR-0006 Rule 7: heartbeat event).
 * Refreshes updated_at while connected=true so readers can detect staleness.
 * Timer is unref'd — will not keep the process alive alone.
 */
export function startHeartbeat(): void {
  stopHeartbeat();
  _heartbeatTimer = setInterval(() => {
    writeBridgeStatus({ connected: true, health: 'healthy' });
  }, 10_000);
  _heartbeatTimer.unref();
}

/** Stop heartbeat timer (call on panel disconnect or shutdown). */
export function stopHeartbeat(): void {
  if (_heartbeatTimer !== null) {
    clearInterval(_heartbeatTimer);
    _heartbeatTimer = null;
  }
}
