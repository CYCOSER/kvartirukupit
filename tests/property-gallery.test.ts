import test from 'node:test';
import assert from 'node:assert/strict';
import { createError } from 'h3';

test('detail gallery reuses published complex photos after apartment images without duplicates or writes', async () => {
  const image = (id: string, file: string, kind = 'photo', order = 0) => ({ id, file, kind, order, alt: id });
  const plan = image('apartment-plan', '/uploads/plan.webp', 'plan');
  const ownPhoto = image('own-photo', '/uploads/shared.webp', 'photo', 1);
  const facade = image('facade', '/uploads/facade.webp', 'photo', 3);
  const complexImages = [
    image('complex-plan', '/uploads/complex-plan.webp', 'plan'),
    image('shared-photo', ownPhoto.file, 'photo', 1),
    facade,
    image('duplicate-facade', facade.file, 'photo', 4),
  ];
  const complex = { id: 'complex', title: 'ЖК Тест', slug: 'test-complex', published: true };
  let property: any = { type: 'apartment', slug: 'test-apartment', title: 'Квартира', sourceMode: null,
    images: [plan, ownPhoto], complex: { ...complex, images: complexImages }, apartments: [] };
  const globals = globalThis as any;
  const replacements = {
    defineEventHandler: (handler: unknown) => handler,
    getRouterParam: () => 'test-apartment',
    createError,
    db: { property: { findFirst: async (query: any) => {
      assert.deepEqual(query.where, { slug: 'test-apartment', published: true });
      assert.deepEqual(query.include.complex.where, { published: true });
      assert.deepEqual(query.include.complex.select.images, {
        where: { kind: 'photo' }, orderBy: { order: 'asc' },
      });
      if (!property) return null;
      return { ...property, complex: property.complex?.published ? {
        ...property.complex,
        images: property.complex.images.filter((value: typeof plan) => value.kind === 'photo')
          .sort((a: typeof plan, b: typeof plan) => a.order - b.order),
      } : null };
    } } },
  };
  const originals = Object.keys(replacements).map(name => [name, globals[name]] as const);
  Object.assign(globals, replacements);
  try {
    const { default: handler } = await import('../server/api/properties/[slug].get');
    const result = await handler({} as any);
    assert.deepEqual(result.images, [plan, ownPhoto, facade]);
    assert.strictEqual(result.images[2], facade);
    assert.deepEqual(result.complex, complex);
    assert.deepEqual(property.images, [plan, ownPhoto]);
    assert.equal(property.complex.images.length, 4);

    property.images = [];
    assert.deepEqual((await handler({} as any)).images, [complexImages[1], facade]);
    property.images = [plan];
    property.type = 'complex';
    assert.deepEqual((await handler({} as any)).images, [plan]);
    property.type = 'apartment';
    property.complex.published = false;
    assert.deepEqual((await handler({} as any)).images, [plan]);
    assert.equal((await handler({} as any)).complex, null);
    property.complex = null;
    assert.deepEqual((await handler({} as any)).images, [plan]);
    property = null;
    await assert.rejects(handler({} as any), { statusCode: 404 });
  } finally {
    for (const [name, value] of originals) {
      if (value === undefined) delete globals[name];
      else globals[name] = value;
    }
  }
});
