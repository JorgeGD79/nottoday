# ---- Build ----
FROM node:20-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- Runtime ----
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
# Copiamos node_modules del build (incluye el cliente Prisma generado y el CLI
# de Prisma, necesario para aplicar migraciones al arrancar).
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY prisma ./prisma
COPY public ./public
COPY docker-entrypoint.sh ./
# Render inyecta la variable PORT; el server escucha en env.PORT y host 0.0.0.0.
EXPOSE 4123
# El script encapsula "migrate + start" para no depender de operadores de shell
# (&&) en el comando, que Render trocea y rompe.
CMD ["sh", "docker-entrypoint.sh"]
