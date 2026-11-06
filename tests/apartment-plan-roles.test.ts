import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveNmarketPlanRoles } from '../server/utils/apartment-plan-roles';
import type { NmarketObject } from '../server/utils/nmarket-data';

const plan = (id: string, file: string, planRole: string | null = null) =>
  ({ id, file: `/uploads/${file}`, originalFile: null, kind: 'plan', planRole });
const offer = (id: string, images: NmarketObject['images']) => ({ id: `apartment:${id}`, type: 'apartment', supported: true, images }) as NmarketObject;
const image = (url: string, planRole: 'unit' | 'floor' | null) => ({ url, plan: true, planRole });
const property = (id: string, sourceId: string, images: ReturnType<typeof plan>[], aliases: string[] = []) =>
  ({ id, sourceId, images, importSources: aliases.map(sourceId => ({ sourceId })) });

test('legacy roles come only from the property source aliases and cached XML image files', async () => {
  const properties = [
    property('a', 'nmarket:apartment:1', [plan('unit', 'unit.webp'), plan('floor', 'floor-plan.webp'),
      plan('alias-floor', 'floor2.webp'), plan('manual', 'manual.webp'), plan('known', 'floor-plan.webp', 'unit'),
      { ...plan('photo', 'unit.webp'), kind: 'photo' }], ['nmarket:apartment:2']),
    property('b', 'nmarket:apartment:3', [plan('unrelated', 'unit.webp')]),
  ];
  const before = structuredClone(properties);
  const items = [offer('1', [image('unit-url', 'unit'), image('floor-url', 'floor'), image('uncached-url', 'floor')]),
    offer('2', [image('alias-floor-url', 'floor')])];
  const rows = [
    { url: 'unit-url', originalFile: '/uploads/unit.webp', planFile: '/uploads/unit-plan.webp' },
    { url: 'floor-url', originalFile: '/uploads/floor.webp', planFile: '/uploads/floor-plan.webp' },
    { url: 'alias-floor-url', originalFile: '/uploads/floor2.webp', planFile: null },
  ];
  const client = { importImageCache: { findMany: async () => rows } } as any;
  assert.deepEqual([...await resolveNmarketPlanRoles(properties, items, client)],
    [['unit', { role: 'unit', originalFile: '/uploads/unit.webp' }],
      ['floor', { role: 'floor', originalFile: '/uploads/floor-plan.webp' }],
      ['alias-floor', { role: 'floor', originalFile: '/uploads/floor2.webp' }]]);
  assert.deepEqual(properties, before, 'dry-run resolution leaves stored images untouched');
});

test('conflicting or unknown explicit plan roles stay ambiguous across aliases', async () => {
  const source = property('a', 'nmarket:apartment:1', [plan('conflict', 'shared.webp'), plan('unknown', 'unknown.webp')],
    ['nmarket:apartment:2', 'nmarket:apartment:3']);
  const items = [offer('1', [image('u', 'unit'), image('unknown', null)]),
    offer('2', [image('f', 'floor')]), offer('3', [image('third', 'unit')])];
  const rows = ['u', 'f', 'third'].map(url => ({ url, originalFile: '/uploads/shared.webp', planFile: null }));
  rows.push({ url: 'unknown', originalFile: '/uploads/unknown.webp', planFile: null });
  const client = { importImageCache: { findMany: async () => rows } } as any;
  assert.deepEqual([...await resolveNmarketPlanRoles([source], items, client)],
    [['conflict', { role: null, originalFile: '/uploads/shared.webp' }],
      ['unknown', { role: null, originalFile: '/uploads/unknown.webp' }]]);
});

test('missing snapshot sources do not query image cache; database failures are not hidden', async () => {
  const source = property('a', 'nmarket:apartment:1', [plan('unit', 'unit.webp')]);
  const failure = new Error('database unavailable');
  const client = { importImageCache: { findMany: async () => { throw failure; } } } as any;
  assert.equal((await resolveNmarketPlanRoles([source], [], client)).size, 0);
  await assert.rejects(resolveNmarketPlanRoles([source], [offer('1', [image('url', 'unit')])], client), failure);
});
