import test from 'node:test';
import assert from 'node:assert/strict';
import { computed, reactive } from 'vue';
import { usePageSeo } from '../composables/usePageSeo';

test('canonical normalizes URLs and follows valid catalog pagination reactively', () => {
  const route = reactive<{ path: string; query: Record<string, string | string[]> }>({
    path: '/catalog/', query: { page: '2', utm_source: 'test' },
  });
  let head!: () => { link: { href: string }[] };
  let meta!: { ogUrl: () => string };
  Object.assign(globalThis, {
    computed,
    useRuntimeConfig: () => ({ public: { siteUrl: 'https://example.test/', siteName: 'Test' } }),
    useRoute: () => route,
    useHead: (value: typeof head) => { head = value; },
    useSeoMeta: (value: typeof meta) => { meta = value; },
  });
  usePageSeo('Каталог', 'Описание');
  const canonical = () => head().link[0].href;
  assert.equal(canonical(), 'https://example.test/catalog?page=2');
  route.query.page = '3';
  assert.equal(canonical(), 'https://example.test/catalog?page=3');
  assert.equal(meta.ogUrl(), canonical());
  for (const page of ['1', '0', '-1', '2.5', 'NaN', '10001', ['2', '3']]) {
    route.query.page = page;
    assert.equal(canonical(), 'https://example.test/catalog');
  }
  route.query = { page: '2', view: 'map' };
  assert.equal(canonical(), 'https://example.test/catalog');
  route.path = '/elite/';
  route.query = { page: '2' };
  assert.equal(canonical(), 'https://example.test/elite?page=2');
  route.path = '/blog/';
  assert.equal(canonical(), 'https://example.test/blog');
  route.path = '/';
  assert.equal(canonical(), 'https://example.test/');
});
