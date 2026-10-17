FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts
RUN mkdir -p /app/.smm && chown -R node:node /app
USER node
ENV SMM_HOST=0.0.0.0 SMM_PORT=8787 SMM_MEMORY_PATH=/app/.smm/memory.jsonl SMM_LEDGER_PATH=/app/.smm/ledger.jsonl
EXPOSE 8787
VOLUME ["/app/.smm"]
CMD ["node", "src/server.js"]
