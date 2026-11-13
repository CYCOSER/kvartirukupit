import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, createRouter, toWebHandler } from 'h3';
import { db } from '../server/utils/db';
import { scheduleArticlePublication } from '../server/utils/article-publication';
import list from '../server/api/agent/v1/articles/index.get';
import create from '../server/api/agent/v1/articles/index.post';
import get from '../server/api/agent/v1/articles/[id].get';
import patch from '../server/api/agent/v1/articles/[id].patch';
import remove from '../server/api/agent/v1/articles/[id].delete';

const router = createRouter()
  .get('/articles', list).post('/articles', create)
  .get('/articles/:id', get).patch('/articles/:id', patch).delete('/articles/:id', remove);
const handle = toWebHandler(createApp().use(router));
const request = (path: string, method = 'GET', body?: unknown) => handle(new Request(`http://localhost${path}`, {
  method, headers: { 'Content-Type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
}));
const article = {
  id: 'article-one', title: 'Тестовая статья', slug: 'test-article', excerpt: 'Краткий анонс статьи.',
  content: '<p>Достаточно длинный текст статьи о выборе квартиры.</p>',
  image: '/uploads/existing.webp', imageAlt: 'Существующая обложка',
  seoTitle: 'Существующий SEO', seoDescription: 'Описание для поиска', seoKeywords: 'квартиры',
  published: false, publishedAt: null as Date | null, updatedAt: new Date('2026-11-01T10:00:00Z'),
};

function mockArticles(t: TestContext, current: typeof article | null = article) {
  const original = { findUnique: db.article.findUnique, create: db.article.create, update: db.article.update,
    deleteMany: db.article.deleteMany, findMany: db.article.findMany, count: db.article.count };
  const findUnique = t.mock.fn(async (_args: any) => current);
  const create = t.mock.fn(async ({ data }: any) => ({ ...article, ...data }));
  const update = t.mock.fn(async ({ data }: any) => ({ ...current, ...data }));
  const deleteMany = t.mock.fn(async (_args: any) => ({ count: current ? 1 : 0 }));
  const findMany = t.mock.fn(async (_args: any) => []);
  const count = t.mock.fn(async (_args: any) => 0);
  Object.assign(db.article, { findUnique, create, update, deleteMany, findMany, count });
  t.after(() => { Object.assign(db.article, original); scheduleArticlePublication(article.id, null); });
  return { findUnique, create, update, deleteMany, findMany, count };
}

test('agent creates a sanitized draft with existing article validation', async (t) => {
  const mocks = mockArticles(t);
  const response = await request('/articles', 'POST', {
    title: article.title, slug: article.slug, excerpt: article.excerpt,
    content: article.content + '<script>alert(1)</script>',
  });
  assert.equal(response.status, 200);
  const saved = await response.json();
  assert.equal(saved.published, false);
  assert.equal(saved.publishedAt, null);
  assert.equal(saved.content, article.content);
  assert.equal(mocks.create.mock.callCount(), 1);
  assert.equal((await request('/articles', 'POST', { title: 'x' })).status, 400);
  assert.equal(mocks.create.mock.callCount(), 1);
});

test('agent PATCH preserves omitted SEO, cover, and scheduled publication', async (t) => {
  const scheduled = { ...article, publishedAt: new Date('2099-01-01T10:00:00Z') };
  const mocks = mockArticles(t, scheduled);
  const response = await request('/articles/article-one', 'PATCH', { title: 'Новый заголовок' });
  assert.equal(response.status, 200);
  const saved = await response.json();
  assert.equal(saved.title, 'Новый заголовок');
  assert.equal(saved.seoTitle, article.seoTitle);
  assert.equal(saved.image, article.image);
  assert.equal(saved.published, false);
  assert.equal(saved.publishedAt, scheduled.publishedAt.toISOString());
  assert.deepEqual(mocks.update.mock.calls[0].arguments[0], {
    where: { id: article.id, updatedAt: article.updatedAt },
    data: { title: 'Новый заголовок', published: false, publishedAt: scheduled.publishedAt },
  });
});

test('agent PATCH sanitizes content and rejects empty, unknown, or invalid fields', async (t) => {
  const mocks = mockArticles(t);
  const response = await request('/articles/article-one', 'PATCH', {
    content: article.content + '<script>alert(1)</script><a href="javascript:alert(1)">Ссылка</a>',
  });
  assert.equal(response.status, 200);
  assert.doesNotMatch((await response.json()).content, /script|javascript/);
  for (const body of [{}, null, [], { price: 1 }, { image: '/bad' }, { content: '<script>unsafe</script>' },
    { published: 'false' }, { title: 'x' }, { content: 'x'.repeat(50001) }]) {
    assert.equal((await request('/articles/article-one', 'PATCH', body)).status, 400, JSON.stringify(body));
  }
  assert.equal(mocks.update.mock.callCount(), 1);
});

test('agent can publish now, schedule, and return a scheduled article to drafts', async (t) => {
  const mocks = mockArticles(t);
  let response = await request('/articles/article-one', 'PATCH', { published: true });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).published, true);
  response = await request('/articles/article-one', 'PATCH', { published: true, publishedAt: '2099-01-01T10:00:00Z' });
  assert.equal(response.status, 200);
  const scheduled = await response.json();
  assert.equal(scheduled.published, false);
  assert.equal(scheduled.publishedAt, '2099-01-01T10:00:00.000Z');
  mocks.findUnique.mock.mockImplementation(async () => ({ ...article, publishedAt: new Date(scheduled.publishedAt) }));
  response = await request('/articles/article-one', 'PATCH', { published: false });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).publishedAt, null);
  response = await request('/articles/article-one', 'PATCH', { publishedAt: null });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).publishedAt, null);
});

test('agent reports duplicate slugs and concurrent changes as conflicts', async (t) => {
  const mocks = mockArticles(t);
  mocks.create.mock.mockImplementation(async () => { throw { code: 'P2002' }; });
  assert.equal((await request('/articles', 'POST', article)).status, 409);
  for (const code of ['P2002', 'P2025']) {
    mocks.update.mock.mockImplementation(async () => { throw { code }; });
    assert.equal((await request('/articles/article-one', 'PATCH', { slug: 'new-slug' })).status, 409);
  }
});

test('agent reads and deletes articles by ID and returns 404 for missing records', async (t) => {
  const mocks = mockArticles(t);
  assert.equal((await request('/articles/article-one')).status, 200);
  const response = await request('/articles/article-one', 'DELETE');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(mocks.deleteMany.mock.calls[0].arguments[0], { where: { id: article.id } });
  mocks.findUnique.mock.mockImplementation(async () => null);
  mocks.deleteMany.mock.mockImplementation(async () => ({ count: 0 }));
  assert.equal((await request('/articles/missing')).status, 404);
  assert.equal((await request('/articles/missing', 'PATCH', { title: 'Новый заголовок' })).status, 404);
  assert.equal((await request('/articles/missing', 'DELETE')).status, 404);
});

test('agent article search is bounded and lists summaries for drafts and published entries', async (t) => {
  const mocks = mockArticles(t);
  const response = await request('/articles?limit=2&offset=4&q=test&published=false&slug=test-article');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { items: [], total: 0, limit: 2, offset: 4 });
  const query = mocks.findMany.mock.calls[0].arguments[0];
  assert.equal(query.take, 2);
  assert.equal(query.skip, 4);
  assert.equal(query.where.published, false);
  assert.equal(query.where.slug, article.slug);
  assert.equal(query.select.content, undefined);
  assert.deepEqual(query.orderBy, { id: 'asc' });
  for (const query of ['limit=101', 'offset=-1', 'published=no', 'limit=1&limit=2', 'unknown=true'])
    assert.equal((await request(`/articles?${query}`)).status, 400);
  assert.equal(mocks.findMany.mock.callCount(), 1);
});
