# Build context is the repo root (see infra/compose/docker-compose.yml) so
# this image can vendor packages/contracts/typescript at build time.
FROM node:20-slim AS build
WORKDIR /app
COPY apps/web/package.json apps/web/package-lock.json* ./
RUN npm install
COPY apps/web ./
COPY packages/contracts/typescript /packages/contracts/typescript
RUN npm run build

FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
