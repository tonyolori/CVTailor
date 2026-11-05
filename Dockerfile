# Worker image. Stateless: all config comes from env vars, so it can move to a cheap VPS unchanged.
# Needs LLM_PROVIDER=anthropic-api or deepseek. Subscription mode relies on a Claude login on the host.
FROM node:24-slim
ENV NODE_ENV=production

WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/llm/package.json packages/llm/
COPY packages/render/package.json packages/render/

# Workspace packages run as TypeScript through tsx, a runtime dependency of the worker.
RUN npm ci --workspace @cvtailor/worker --ignore-scripts \
  && rm -rf node_modules/@anthropic-ai/claude-agent-sdk-* node_modules/supabase

COPY packages packages
COPY apps/worker apps/worker

RUN mkdir -p /app/.local && chown -R node:node /app/.local
USER node
WORKDIR /app/apps/worker
CMD ["npx", "tsx", "src/main.ts", "--loop"]
