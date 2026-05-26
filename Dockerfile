FROM node:20-alpine

# Security: run as non-root
RUN addgroup -g 1001 -S relay && \
    adduser -S relay -u 1001 -G relay

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --production && npm cache clean --force

COPY src/ ./src/

RUN mkdir -p /app/data && chown -R relay:relay /app

USER relay

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "src/index.js"]
