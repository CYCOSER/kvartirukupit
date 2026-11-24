import test from 'node:test';
import assert from 'node:assert/strict';

test('llms.txt includes only published complex metadata for published apartments', async () => {
  const apartment = { slug: 'apartment', title: 'Квартира', type: 'apartment', location: 'Калининград', price: null,
    area: null, bedrooms: null, status: 'available', readiness: 'Готов', description: '', elite: false };
  const complexes = [
    { title: 'Опубликованный ЖК', slug: 'published-complex', published: true },
    { title: 'Скрытый черновик ЖК', slug: 'draft-complex', published: false },
  ];
  const globals = globalThis as any;
  const replacements = {
    defineEventHandler: (handler: unknown) => handler,
    useRuntimeConfig: () => ({ public: { siteUrl: 'https://example.test', siteName: 'Тестовый сайт' } }),
    setHeader: () => {},
    db: {
      property: { findMany: async (query: any) => {
        assert.deepEqual(query.where, { published: true });
        assert.deepEqual(query.select.complex.where, { published: true });
        return complexes.map(complex => ({ ...apartment, complex: complex.published === query.select.complex.where.published ? complex : null }));
      } },
      article: { findMany: async () => [] },
    },
  };
  const originals = Object.keys(replacements).map(name => [name, globals[name]] as const);
  Object.assign(globals, replacements);
  try {
    const { default: handler } = await import('../server/routes/llms.txt.get');
    const result = await handler({} as any);
    assert.match(result, /ЖК Опубликованный ЖК/);
    assert.doesNotMatch(result, /Скрытый черновик ЖК|draft-complex/);
    assert.equal((result.match(/https:\/\/example\.test\/catalog\/apartment/g) || []).length, 2);
  } finally {
    for (const [name, value] of originals) {
      if (value === undefined) delete globals[name];
      else globals[name] = value;
    }
  }
});
