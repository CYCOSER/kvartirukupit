import { createHash, randomBytes } from "node:crypto";
import type { H3Event } from "h3";
import { db } from "./db";

const cookieName = "article_session";
const sessionLifetimeMs = 24 * 60 * 60 * 1000;

function sessionDigest(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function getOrCreateArticleVisitorSession(event: H3Event) {
  const existingToken = getCookie(event, cookieName);
  const validExistingToken =
    existingToken && /^[a-f0-9]{64}$/.test(existingToken)
      ? existingToken
      : undefined;
  if (validExistingToken) {
    const existingId = sessionDigest(validExistingToken);
    const existingSession = await db.articleVisitorSession.findUnique({
      where: { id: existingId },
      select: { expiresAt: true },
    });
    const now = new Date();
    if (existingSession && existingSession.expiresAt > now) {
      await db.articleVisitorSession.update({
        where: { id: existingId },
        data: { lastSeenAt: now },
      });
      return existingId;
    }
  }

  const token = randomBytes(32).toString("hex");
  const id = sessionDigest(token);
  const now = new Date();
  await db.articleVisitorSession.create({
    data: {
      id,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + sessionLifetimeMs),
    },
  });
  setCookie(event, cookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure:
      process.env.NODE_ENV === "production" &&
      useRuntimeConfig(event).public.siteUrl.startsWith("https://"),
    path: "/",
    maxAge: sessionLifetimeMs / 1000,
  });
  return id;
}

export async function getArticleVisitorSessionId(event: H3Event) {
  const token = getCookie(event, cookieName);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const session = await db.articleVisitorSession.findFirst({
    where: {
      id: sessionDigest(token),
      expiresAt: { gt: new Date() },
    },
    select: { id: true },
  });
  return session?.id || null;
}
