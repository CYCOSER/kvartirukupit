import { db } from '../../server/utils/db';

export function mockImageFingerprintCache() {
  const model = db.imageFingerprint;
  const original = { findUnique: model.findUnique, upsert: model.upsert };
  const rows = new Map<string, { file: string; signature: string; hash: string }>();
  model.findUnique = (async ({ where }: any) => structuredClone(rows.get(where.file) || null)) as any;
  model.upsert = (async ({ where, create, update }: any) => {
    const row = { ...(rows.get(where.file) || create), ...update };
    rows.set(where.file, structuredClone(row));
    return structuredClone(row);
  }) as any;
  return { rows, restore() { Object.assign(model, original); } };
}
