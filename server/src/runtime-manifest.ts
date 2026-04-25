/**
 * runtime-manifest.ts
 * Atomic-write helper for JSON manifests (ADR-0002).
 * Shared by bridge-status.ts and session-state.ts.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export type ManifestData = Record<string, unknown>;

/**
 * Atomic write of a JSON manifest. Auto-injects updated_at (ISO-8601 UTC).
 * Caller owns schema_version and all other fields.
 * Uses fs.renameSync — ADR-0002 Rule 2 (sync, NTFS atomic).
 */
export function writeManifest(absolutePath: string, data: ManifestData): void {
  const enriched = { ...data, updated_at: new Date().toISOString() };
  const json = JSON.stringify(enriched, null, 2);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  const tmp = `${absolutePath}.tmp`;
  fs.writeFileSync(tmp, json, 'utf8');
  fs.renameSync(tmp, absolutePath);
}
