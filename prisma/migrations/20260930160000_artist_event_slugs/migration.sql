-- AlterTable
ALTER TABLE "Artist" ADD COLUMN "slug" TEXT;
ALTER TABLE "Event" ADD COLUMN "slug" TEXT;

-- Slug de los artistas existentes: nombre artístico normalizado; si dos
-- coinciden, el segundo lleva "-2", el tercero "-3"...
WITH base AS (
  SELECT "id", coalesce(nullif(trim(both '-' from regexp_replace(
    lower(translate("stageName", 'áéíóúàèìòùäëïöüâêîôûñçÁÉÍÓÚÀÈÌÒÙÄËÏÖÜÂÊÎÔÛÑÇ', 'aeiouaeiouaeiouaeiouncaeiouaeiouaeiouaeiounc')),
    '[^a-z0-9]+', '-', 'g')), ''), 'artista') AS "s"
  FROM "Artist"
), numbered AS (
  SELECT "id", "s", row_number() OVER (PARTITION BY "s" ORDER BY "id") AS "n" FROM base
)
UPDATE "Artist" a SET "slug" = CASE WHEN n."n" = 1 THEN n."s" ELSE n."s" || '-' || n."n" END
FROM numbered n WHERE a."id" = n."id";

-- Slug de los eventos existentes: título normalizado + fecha (AAAA-MM-DD).
WITH base AS (
  SELECT "id", coalesce(nullif(trim(both '-' from regexp_replace(
    lower(translate("title", 'áéíóúàèìòùäëïöüâêîôûñçÁÉÍÓÚÀÈÌÒÙÄËÏÖÜÂÊÎÔÛÑÇ', 'aeiouaeiouaeiouaeiouncaeiouaeiouaeiouaeiounc')),
    '[^a-z0-9]+', '-', 'g')), ''), 'evento') || '-' || to_char("date", 'YYYY-MM-DD') AS "s"
  FROM "Event"
), numbered AS (
  SELECT "id", "s", row_number() OVER (PARTITION BY "s" ORDER BY "id") AS "n" FROM base
)
UPDATE "Event" e SET "slug" = CASE WHEN n."n" = 1 THEN n."s" ELSE n."s" || '-' || n."n" END
FROM numbered n WHERE e."id" = n."id";

ALTER TABLE "Artist" ALTER COLUMN "slug" SET NOT NULL;
ALTER TABLE "Event" ALTER COLUMN "slug" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Artist_slug_key" ON "Artist"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Event_slug_key" ON "Event"("slug");
