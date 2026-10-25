FROM node:22-alpine AS builder
RUN apk add --no-cache openssl
WORKDIR /app
COPY package*.json .npmrc ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
RUN npx prisma generate && npx nuxt prepare && npm run build

FROM node:22-alpine
RUN apk add --no-cache openssl
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 UPLOAD_DIR=/app/uploads
WORKDIR /app
COPY --from=builder --chown=node:node /app/.output ./.output
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/prisma ./prisma
COPY --from=builder --chown=node:node /app/shared ./shared
COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node data/curated ./data/curated
RUN mkdir -p /app/uploads /app/rf39 && chown node:node /app/uploads /app/rf39
USER node
EXPOSE 3000
CMD ["sh", "scripts/entrypoint.sh"]
