import { z } from 'zod';
export default defineEventHandler(async (event) => {
  const data = z
    .array(z.object({ id: z.string(), alt: z.string().trim().min(1).max(200) }))
    .max(100)
    .safeParse(await readBody(event));
  if (!data.success)
    throw createError({ statusCode: 400, statusMessage: 'Invalid gallery' });
  const id = getRouterParam(event, 'id')!;
  await db.$transaction(async (tx) => {
    const images = await tx.propertyImage.findMany({
      where: { propertyId: id },
    });
    if (
      new Set(data.data.map((v) => v.id)).size !== data.data.length ||
      data.data.some((v) => !images.some((i) => i.id === v.id))
    )
      throw createError({ statusCode: 400, statusMessage: 'Invalid gallery' });
    await tx.propertyImage.deleteMany({
      where: { propertyId: id, id: { notIn: data.data.map((v) => v.id) } },
    });
    for (const [order, img] of data.data.entries())
      await tx.propertyImage.update({
        where: { id: img.id },
        data: { order, alt: img.alt },
      });
  });
  return { ok: true };
});
