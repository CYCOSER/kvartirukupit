#!/bin/sh
set -eu
./node_modules/.bin/prisma migrate deploy
./node_modules/.bin/tsx prisma/seed.ts
exec node .output/server/index.mjs
