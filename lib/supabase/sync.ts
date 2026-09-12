import type { User } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { db } from '@/lib/db/schema';
import { rebuildMarkers } from '@/lib/db/repo';
import { getSupabaseBrowserClient } from './client';

// Presentation preferences are deliberately device-local. A phone, tablet and
// desktop need different scale/font choices, so syncing `settings` would make
// the most recently adjusted device overwrite every other one.
const SYNC_TABLES = ['categories', 'categoryVerses', 'notes', 'bookmarks', 'readingState'] as const;
type SyncTable = (typeof SYNC_TABLES)[number];

type RemoteRecord = {
  user_id: string;
  table_name: SyncTable;
  record_id: string;
  payload: Record<string, unknown>;
  updated_at: number;
  deleted_at: number | null;
};

const isSyncTable = (value: string): value is SyncTable =>
  (SYNC_TABLES as readonly string[]).includes(value);

function localTable(name: SyncTable) {
  return db()[name] as unknown as {
    get: (id: string) => Promise<Record<string, unknown> | undefined>;
    put: (value: Record<string, unknown>) => Promise<unknown>;
  };
}

let running: Promise<void> | null = null;
let rerunRequested = false;

const REMOTE_PAGE_SIZE = 1000;
const UPLOAD_BATCH_SIZE = 200;

async function fetchAllRemoteRecords(supabase: SupabaseClient, userId: string) {
  const rows: RemoteRecord[] = [];
  for (let from = 0; ; from += REMOTE_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('user_records')
      .select('user_id,table_name,record_id,payload,updated_at,deleted_at')
      .eq('user_id', userId)
      .order('table_name', { ascending: true })
      .order('record_id', { ascending: true })
      .range(from, from + REMOTE_PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data ?? []) as RemoteRecord[];
    rows.push(...page);
    if (page.length < REMOTE_PAGE_SIZE) return rows;
  }
}

function chunks<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

/** Push local operations, then merge the authenticated user's complete cloud copy. */
export function syncNow(user: User): Promise<void> {
  rerunRequested = true;
  if (running) return running;
  running = (async () => {
    while (rerunRequested) {
      rerunRequested = false;
      await performSync(user);
    }
  })().finally(() => { running = null; });
  return running;
}

async function performSync(user: User) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return;
  const d = db();
  const pending = await d.outbox.orderBy('seq').toArray();

  // Supabase limits a select to 1,000 rows by default. A Quran collection can
  // exceed that with verse assignments alone, so always page the complete
  // account mirror. This snapshot also replaces one conflict-check request per
  // pending record.
  let remoteRows = await fetchAllRemoteRecords(supabase, user.id);
  const remoteByKey = new Map<string, RemoteRecord>(
    remoteRows.map((row) => [`${row.table_name}\u0000${row.record_id}`, row] as const),
  );

  // Multiple edits to one record can accumulate while offline. Only its newest
  // payload needs uploading, and batches keep a large first sync practical.
  const newestPending = new Map<string, (typeof pending)[number]>();
  for (const item of pending) {
    if (!isSyncTable(item.table)) continue;
    const key = `${item.table}\u0000${item.recordId}`;
    const previous = newestPending.get(key);
    const updatedAt = Number((item.payload as Record<string, unknown>).updatedAt ?? item.at);
    const previousAt = previous
      ? Number((previous.payload as Record<string, unknown>).updatedAt ?? previous.at)
      : -1;
    if (!previous || updatedAt >= previousAt) newestPending.set(key, item);
  }

  const uploads: RemoteRecord[] = [];
  for (const [key, item] of newestPending) {
    if (!isSyncTable(item.table)) continue;
    const payload = item.payload as Record<string, unknown>;
    const updatedAt = Number(payload.updatedAt ?? item.at);
    const existing = remoteByKey.get(key);
    if (!existing || updatedAt >= Number(existing.updated_at)) {
      uploads.push({
        user_id: user.id,
        table_name: item.table,
        record_id: item.recordId,
        payload,
        updated_at: updatedAt,
        deleted_at: typeof payload.deletedAt === 'number' ? payload.deletedAt : null,
      });
    }
  }

  for (const batch of chunks(uploads, UPLOAD_BATCH_SIZE)) {
    const { error } = await supabase
      .from('user_records')
      .upsert(batch, { onConflict: 'user_id,table_name,record_id' });
    if (error) throw error;
  }
  const completedSeqs = pending
    .map((item) => item.seq)
    .filter((seq): seq is number => seq !== undefined);
  if (completedSeqs.length) await d.outbox.bulkDelete(completedSeqs);

  // Read again after upload so local conflict resolution uses the committed
  // cloud copy and includes changes another device made during this sync.
  remoteRows = await fetchAllRemoteRecords(supabase, user.id);
  for (const row of remoteRows) {
    if (!isSyncTable(row.table_name)) continue;
    const table = localTable(row.table_name);
    const local = await table.get(row.record_id);
    const localUpdated = Number(local?.updatedAt ?? 0);
    if (!local || Number(row.updated_at) > localUpdated) {
      await table.put(row.payload as Record<string, unknown>);
    }
  }
  await rebuildMarkers();
}
