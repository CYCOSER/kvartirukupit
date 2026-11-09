import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, toWebHandler } from 'h3';
import { db } from '../server/utils/db';
import homeProperties from '../server/api/properties/random.get';

const request = () => toWebHandler(createApp().use('/properties/random', homeProperties))(
  new Request('http://localhost/properties/random'),
);

function fixture(t: TestContext, ids: string[], items: unknown[]) {
  const originalSample = db.$queryRaw;
  const originalFind = db.property.findMany;
  const sample = t.mock.fn(async (..._args: any[]) => ids.map(id => ({ id })));
  const find = t.mock.fn(async (..._args: any[]) => items);
  db.$queryRaw = sample as any;
  db.property.findMany = find as any;
  t.after(() => {
    db.$queryRaw = originalSample;
    db.property.findMany = originalFind;
  });
  return { sample, find };
}

test('homepage samples only featured public objects and rechecks eligibility before returning them', async (t) => {
  const { sample, find } = fixture(t, ['complex', 'removed', 'apartment'], [
    { id: 'apartment', title: 'Квартира', type: 'apartment', sourceMode: null },
    { id: 'complex', title: 'ЖК у моря', type: 'complex', sourceMode: null },
  ]);
  const response = await request();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual((await response.json()).items.map((item: { id: string }) => item.id), ['complex', 'apartment']);
  const sql = Array.from(sample.mock.calls[0]!.arguments[0] as TemplateStringsArray).join('');
  assert.match(sql, /WHERE published = true AND featured = true AND status = 'available' AND elite = false/);
  assert.deepEqual(find.mock.calls[0]!.arguments[0]!.where, {
    id: { in: ['complex', 'removed', 'apartment'] },
    published: true, featured: true, elite: false, status: 'available',
  });
});

test('homepage stays empty without featured objects instead of falling back to the catalog', async (t) => {
  const { sample, find } = fixture(t, [], []);
  const response = await request();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { items: [] });
  assert.equal(sample.mock.callCount(), 1);
  assert.equal(find.mock.callCount(), 1);
  assert.deepEqual(find.mock.calls[0]!.arguments[0]!.where!.id, { in: [] });
});
