FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# The hosted web app calls its own origin. No secrets enter the browser build.
RUN CLOSER_BUILD_TARGET=web npm run build:web

FROM node:22-alpine AS production
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build --chown=node:node /app/www/ ./
COPY --from=build --chown=node:node /app/server.mjs /app/auth.mjs ./
COPY --from=build --chown=node:node /app/scripts/migrate-all.mjs /app/scripts/database-migrations.mjs ./scripts/
COPY --from=build --chown=node:node /app/db/ ./db/
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
