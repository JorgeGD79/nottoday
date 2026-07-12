#!/bin/sh
# Arranque del contenedor: aplica migraciones y lanza el servidor.
# La secuencia vive AQUÍ (no en el comando de Render) para que ningún "&&"
# tenga que sobrevivir al troceo/quoting de la plataforma.
set -e

echo "==> Aplicando migraciones de Prisma..."
npx prisma migrate deploy

echo "==> Arrancando servidor..."
exec node dist/server.js
