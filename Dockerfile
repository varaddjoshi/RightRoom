FROM node:22-alpine
WORKDIR /app
# Dependencies first, so a code-only change reuses this layer.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
# The app lives at the repo root; .dockerignore keeps docs, deploy files and secrets out.
COPY . .
ARG APP_VERSION=dev
ENV PORT=8080 APP_VERSION=$APP_VERSION NODE_ENV=production
# The node image's "node" user, by number so runAsNonRoot can check it.
USER 1000
EXPOSE 8080
# npm start loads the OpenTelemetry auto-instrumentation (see package.json).
CMD ["npm", "start"]
