-- CreateEnum
CREATE TYPE "Weekday" AS ENUM ('LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO', 'DOMINGO');

-- CreateTable
CREATE TABLE "RadioShow" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "dayOfWeek" "Weekday" NOT NULL,
    "startTime" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RadioShow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RadioTrack" (
    "id" TEXT NOT NULL,
    "radioShowId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "artist" TEXT NOT NULL,
    "audioUrl" TEXT NOT NULL,
    "durationSeconds" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RadioTrack_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RadioShow_dayOfWeek_startTime_idx" ON "RadioShow"("dayOfWeek", "startTime");

-- CreateIndex
CREATE INDEX "RadioTrack_radioShowId_sortOrder_idx" ON "RadioTrack"("radioShowId", "sortOrder");

-- AddForeignKey
ALTER TABLE "RadioTrack" ADD CONSTRAINT "RadioTrack_radioShowId_fkey" FOREIGN KEY ("radioShowId") REFERENCES "RadioShow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
