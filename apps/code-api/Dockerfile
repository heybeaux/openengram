FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY prisma ./prisma
RUN pnpm prisma generate
COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN pnpm build
RUN pnpm prune --prod

FROM node:22-bookworm-slim AS runner
ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/dist ./dist
EXPOSE 3002
CMD ["node", "--max-old-space-size=4096", "dist/main"]
