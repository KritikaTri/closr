FROM node:22-alpine AS production

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node server.mjs auth.mjs auth.js native-auth.js runtime-config.js \
  app.js index.html login.html status.html memories.html chat.html partner-chat.html \
  tracker.html tracker.js tracker.css styles.css ./
USER node

EXPOSE 8080
CMD ["node", "server.mjs"]
