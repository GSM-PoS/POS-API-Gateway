FROM oven/bun:1-alpine
WORKDIR /app

# Copy dependency files
COPY package.json bun.lock* ./

# Install dependencies
RUN bun install --production --frozen-lockfile || bun install --production

# Copy application source
COPY . .

EXPOSE 8080

CMD ["bun", "run", "src/server.ts"]
