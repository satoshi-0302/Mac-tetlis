FROM node:24-bookworm-slim AS build

WORKDIR /app

COPY . .

RUN npm ci --prefix ./games/asteroid
RUN npm run platform:build:asteroid

FROM node:24-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080
ENV PLATFORM_DATA_DIR=/app/data

COPY --from=build /app /app

RUN mkdir -p /app/data

EXPOSE 8080

CMD ["node", "./platform/server.mjs"]
