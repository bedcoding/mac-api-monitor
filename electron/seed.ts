import type { Database } from './db';

interface SeedEndpoint {
  method: string;
  url: string;
  label: string;
  note?: string;
  group?: string;
}

// 첫 실행 시 자동으로 추가되는 endpoint 목록.
// 기본은 비어 있음 — 사용자가 Endpoints 탭에서 추가하거나 JSON import.
// 특정 프로젝트 전용으로 갖다 쓸 경우 여기에 채워넣으면 됨.
const SEED_ENDPOINTS: SeedEndpoint[] = [];

export function seedIfEmpty(db: Database) {
  if (SEED_ENDPOINTS.length === 0) return;

  const existing = db.listEndpoints();
  if (existing.length > 0) return;

  for (const ep of SEED_ENDPOINTS) {
    db.addEndpoint({
      method: ep.method,
      url: ep.url,
      label: ep.label,
      note: ep.note,
      group: ep.group,
    });
  }

  console.log(`[seed] ${SEED_ENDPOINTS.length} endpoints inserted`);
}
