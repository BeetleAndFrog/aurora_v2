import Dexie, { Table } from 'dexie';
import {
  getNamespace,
  ANONYMOUS_NAMESPACE,
  LEGACY_CLAIM_MARKER,
} from './persistenceContext';

interface UniverseRecord {
  id: string;
  data: any; // The full universe object
  timestamp: number;
  /** BETA-06: owning account namespace; legacy records omit this. */
  ownerId?: string;
}

interface BackupRecord {
  id: string;
  snapshot: any; // Full state snapshot
  timestamp: number;
  label: string;
  /** BETA-06: owning account namespace; legacy records omit this. */
  ownerId?: string;
}

interface VideoFileRecord {
  id: string; // universeId
  videoBlob: Blob;
  mimeType: string;
  timestamp: number;
  /** BETA-06: owning account namespace; legacy records omit this. */
  ownerId?: string;
}

/**
 * Records belong to the current namespace, or (for the anonymous namespace
 * only) may be legacy records that predate account isolation. Signed-in
 * namespaces never see legacy or other-account records.
 */
function ownsRecord(ownerId: string | undefined, ns: string): boolean {
  if (ownerId === ns) return true;
  // Legacy/unowned records are preserved in the signed-out anonymous namespace
  // so offline data is never lost.
  return ns === ANONYMOUS_NAMESPACE && (ownerId === undefined || ownerId === ANONYMOUS_NAMESPACE);
}

/**
 * BETA-06 P1-1: assign `ownerId` to pre-BETA-06 legacy records (universes,
 * backups, videos written without an owner) so they surface in the signed-in
 * namespace instead of staying invisible behind the auth gate.
 *
 * Each legacy record is claimed exactly once: the first account to migrate it
 * writes its ownerId onto the record, after which every other namespace is
 * filtered out by `ownsRecord`. Gated by the same legacy claim marker as the
 * localStorage migration so all legacy stores go to one account (the first to
 * sign in), never split across accounts.
 *
 * Must be called BEFORE any read (`loadAllUniverses`, `listBackups`, ...) so
 * the just-claimed records are visible to the current namespace.
 */
export async function migrateLegacyDexieRecords(): Promise<void> {
  const ns = getNamespace();
  if (ns === ANONYMOUS_NAMESPACE || typeof localStorage === 'undefined') return;
  try {
    // Legacy data already claimed by a different account -> never re-migrate.
    const claimedBy = localStorage.getItem(LEGACY_CLAIM_MARKER);
    if (claimedBy && claimedBy !== ns) return;

    const claim = <T extends { id: string; ownerId?: string }>(r: T): T =>
      ({ ...r, ownerId: ns });
    let migrated = false;

    // `ownerId` is not a schema index, so scan + filter like the existing reads.
    const unownedUniverses = (await db.universes.toArray()).filter(
      (r: UniverseRecord) => r.ownerId === undefined
    );
    if (unownedUniverses.length > 0) {
      await db.universes.bulkPut(unownedUniverses.map(claim as any));
      migrated = true;
    }
    const unownedBackups = (await db.backups.toArray()).filter(
      (r: BackupRecord) => r.ownerId === undefined
    );
    if (unownedBackups.length > 0) {
      await db.backups.bulkPut(unownedBackups.map(claim as any));
      migrated = true;
    }
    const unownedVideos = (await db.videos.toArray()).filter(
      (r: VideoFileRecord) => r.ownerId === undefined
    );
    if (unownedVideos.length > 0) {
      await db.videos.bulkPut(unownedVideos.map(claim as any));
      migrated = true;
    }

    if (migrated && !claimedBy) {
      // First account to claim ANY legacy store owns the whole legacy payload
      // (localStorage base keys + Dexie records).
      localStorage.setItem(LEGACY_CLAIM_MARKER, ns);
    }
  } catch (error) {
    console.error('❌ IndexedDB legacy migration failed:', error);
  }
}

class AstryonDatabase extends Dexie {
  universes!: Table<UniverseRecord>;
  backups!: Table<BackupRecord>;
  videos!: Table<VideoFileRecord>;

  constructor() {
    super('AuroraDB');

    this.version(2).stores({
      universes: 'id, timestamp',
      backups: 'id, timestamp',
      videos: 'id, timestamp'
    });
  }
}

export const db = new AstryonDatabase();

// Save universe to IndexedDB
export async function saveUniverse(id: string, data: any) {
  try {
    await db.universes.put({
      id,
      data,
      timestamp: Date.now(),
      ownerId: getNamespace()
    });
    console.log('✅ Universe saved to IndexedDB:', id);
    return true;
  } catch (error) {
    console.error('❌ IndexedDB save failed:', error);
    return false;
  }
}

// Load universe from IndexedDB
export async function loadUniverse(id: string) {
  try {
    const record = await db.universes.get(id);
    if (!record || !ownsRecord(record.ownerId, getNamespace())) return null;
    return record?.data || null;
  } catch (error) {
    console.error('❌ IndexedDB load failed:', error);
    return null;
  }
}

// Load all universes
export async function loadAllUniverses() {
  try {
    const ns = getNamespace();
    const records = await db.universes.toArray();
    const universes: any = {};
    records.forEach(record => {
      if (ownsRecord(record.ownerId, ns)) {
        universes[record.id] = record.data;
      }
    });
    console.log('✅ Loaded', Object.keys(universes).length, 'universes from IndexedDB');
    return universes;
  } catch (error) {
    console.error('❌ IndexedDB load all failed:', error);
    return {};
  }
}

// Delete universe
export async function deleteUniverseFromDB(id: string) {
  try {
    const record = await db.universes.get(id);
    if (record && !ownsRecord(record.ownerId, getNamespace())) {
      console.warn('⚠️ Refusing to delete universe owned by another namespace:', id);
      return false;
    }
    await db.universes.delete(id);
    console.log('✅ Universe deleted from IndexedDB:', id);
    return true;
  } catch (error) {
    console.error('❌ IndexedDB delete failed:', error);
    return false;
  }
}

// Create backup snapshot
export async function createBackup(state: any, label: string = 'auto') {
  try {
    const ns = getNamespace();
    const backupId = `backup-${Date.now()}`;
    await db.backups.put({
      id: backupId,
      snapshot: state,
      timestamp: Date.now(),
      label,
      ownerId: ns
    });

    // Keep only last 10 backups for this namespace
    const allBackups = await db.backups.orderBy('timestamp').toArray();
    const ownedBackups = allBackups.filter(b => ownsRecord(b.ownerId, ns));
    if (ownedBackups.length > 10) {
      const toDelete = ownedBackups.slice(0, ownedBackups.length - 10);
      await Promise.all(toDelete.map(b => db.backups.delete(b.id)));
    }

    console.log('✅ Backup created:', backupId);
    return true;
  } catch (error) {
    console.error('❌ Backup failed:', error);
    return false;
  }
}

// List available backups
export async function listBackups() {
  try {
    const ns = getNamespace();
    const backups = await db.backups.orderBy('timestamp').reverse().toArray();
    return backups
      .filter(b => ownsRecord(b.ownerId, ns))
      .map(b => ({
        id: b.id,
        timestamp: b.timestamp,
        label: b.label,
        date: new Date(b.timestamp).toLocaleString()
      }));
  } catch (error) {
    console.error('❌ List backups failed:', error);
    return [];
  }
}

// Restore from backup
export async function restoreBackup(backupId: string) {
  try {
    const backup = await db.backups.get(backupId);
    if (!backup || !ownsRecord(backup.ownerId, getNamespace())) {
      console.error('Backup not found or not owned by current namespace:', backupId);
      return null;
    }
    console.log('✅ Backup restored:', backupId);
    return backup.snapshot;
  } catch (error) {
    console.error('❌ Restore failed:', error);
    return null;
  }
}

// Save video file to IndexedDB
export async function saveVideoFile(universeId: string, videoFile: File) {
  try {
    await db.videos.put({
      id: universeId,
      videoBlob: videoFile,
      mimeType: videoFile.type,
      timestamp: Date.now(),
      ownerId: getNamespace()
    });
    console.log('✅ Video file saved to IndexedDB:', universeId);
    return true;
  } catch (error) {
    console.error('❌ Video file save failed:', error);
    return false;
  }
}

// Load video file from IndexedDB
export async function loadVideoFile(universeId: string): Promise<string | null> {
  try {
    const record = await db.videos.get(universeId);
    if (!record || !ownsRecord(record.ownerId, getNamespace())) return null;

    // Convert Blob to Object URL for video playback
    const url = URL.createObjectURL(record.videoBlob);
    console.log('✅ Video file loaded from IndexedDB:', universeId);
    return url;
  } catch (error) {
    console.error('❌ Video file load failed:', error);
    return null;
  }
}

// Delete video file
export async function deleteVideoFile(universeId: string) {
  try {
    const record = await db.videos.get(universeId);
    if (record && !ownsRecord(record.ownerId, getNamespace())) {
      console.warn('⚠️ Refusing to delete video owned by another namespace:', universeId);
      return false;
    }
    await db.videos.delete(universeId);
    console.log('✅ Video file deleted from IndexedDB:', universeId);
    return true;
  } catch (error) {
    console.error('❌ Video file delete failed:', error);
    return false;
  }
}

// ☁️ CLOUD SYNC (NeonDB) — BETA-05 owner-safe CRUD
//
// Deterministic result type so callers never treat an auth failure as a
// normal sync. The client always addresses its own universe by its
// client-generated id (`clientId`); the server scopes by the session user.

export type CloudSaveResult =
  | { ok: true; version?: number }
  // On a genuine conflict the server echoes its authoritative copy in the
  // 409 body (`current`). The client adopts this to clear the sync deadlock.
  | {
      ok: false;
      status: number;
      reason: 'conflict';
      serverVersion?: number;
      serverData?: any;
    }
  | { ok: false; status: number; reason: 'unauthorized' | 'rejected' | 'error' };

// Save universe to Cloud (NeonDB), scoped by clientId + session user.
// `version` is the optimistic-concurrency token the client last observed from
// the server; it is echoed so the server can reject only genuinely stale
// writes (never on clock skew).
export async function saveToCloud(
  clientId: string,
  data: any,
  videoUrl?: string,
  lastModified?: number,
  version?: number
): Promise<CloudSaveResult> {
  try {
    const response = await fetch('/api/universes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, data, videoUrl, lastModified, version }),
    });

    if (response.ok) {
      console.log('✅ Universe saved to Cloud:', clientId);
      let savedVersion: number | undefined;
      try {
        const saved = await response.json();
        if (saved && typeof saved.version === 'number') {
          savedVersion = saved.version;
        }
      } catch {
        // Body not JSON; version stays undefined. Save still succeeded.
      }
      return { ok: true, version: savedVersion };
    }

    if (response.status === 401) {
      // Not signed in. Deterministic and distinct from a normal sync failure.
      console.warn('⚠️ Cloud save skipped: user not authenticated');
      return { ok: false, status: 401, reason: 'unauthorized' };
    }
    if (response.status === 409) {
      // Genuine conflict (client version older than server version). The
      // server echoes its authoritative copy in the body (`current`); extract
      // it so the caller can adopt the server version + data and converge.
      console.warn('⚠️ Cloud save conflict (stale overwrite refused):', clientId);
      let serverVersion: number | undefined;
      let serverData: any;
      try {
        const conflict = await response.json();
        if (conflict && conflict.current && typeof conflict.current.version === 'number') {
          serverVersion = conflict.current.version;
          serverData = conflict.current.data;
        }
      } catch {
        // Body not JSON; server copy unavailable. Caller keeps the universe
        // dirty for a later retry (bounded, not a permanent stall).
      }
      return {
        ok: false,
        status: 409,
        reason: 'conflict',
        serverVersion,
        serverData,
      };
    }
    if (response.status === 400 || response.status === 413) {
      console.warn('⚠️ Cloud save rejected payload:', response.status, clientId);
      return { ok: false, status: response.status, reason: 'rejected' };
    }

    console.warn('⚠️ Cloud save failed:', response.status, response.statusText);
    return { ok: false, status: response.status, reason: 'error' };
  } catch (error) {
    console.error('❌ Cloud save error:', error);
    return { ok: false, status: 0, reason: 'error' };
  }
}

// Delete a universe from Cloud, scoped by clientId + session user.
export async function deleteFromCloud(clientId: string): Promise<boolean> {
  try {
    const response = await fetch('/api/universes', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId }),
    });
    if (response.ok) {
      console.log('✅ Universe deleted from Cloud:', clientId);
      return true;
    }
    console.warn('⚠️ Cloud delete failed:', response.status, response.statusText);
    return false;
  } catch (error) {
    console.error('❌ Cloud delete error:', error);
    return false;
  }
}

// Load all universes from Cloud, keyed by clientId.
export async function loadFromCloud(): Promise<Record<string, any> | null> {
  try {
    const response = await fetch('/api/universes');
    if (response.ok) {
      const universes = await response.json();
      console.log('✅ Loaded universes from Cloud');
      // Convert array to object map keyed by clientId to match loadAllUniverses format.
      const universeMap: Record<string, any> = {};
      universes.forEach((u: any) => {
        // Embed the server-owned version into the returned data so the client
        // can recover the authoritative optimistic-concurrency token even
        // after a fresh load (not just after a save echo).
        const data =
          u.data && typeof u.data === 'object'
            ? { ...u.data, cloudVersion: u.version }
            : u.data;
        universeMap[u.clientId] = data;
      });
      return universeMap;
    }
    if (response.status === 401) {
      console.warn('⚠️ Cloud load skipped: user not authenticated');
      return {};
    }
    return null;
  } catch (error) {
    console.error('❌ Cloud load error:', error);
    return null;
  }
}
