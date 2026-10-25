import { verify } from '@node-rs/argon2';
import { z } from 'zod';
export default defineEventHandler(async (event) => {
  limit(event, 'login', 8);
  const parsed = z
    .object({
      email: z.string().email().max(200),
      password: z.string().min(1).max(200),
    })
    .safeParse(await readBody(event));
  if (!parsed.success)
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid credentials',
    });
  const user = await db.adminUser.findUnique({
    where: { email: parsed.data.email.toLowerCase() },
  });
  if (!user || !(await verify(user.passwordHash, parsed.data.password)))
    throw createError({
      statusCode: 401,
      statusMessage: 'Invalid credentials',
    });
  await createSession(event, user.id);
  return { ok: true };
});
