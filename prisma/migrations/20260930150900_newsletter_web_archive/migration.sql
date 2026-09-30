-- AlterTable
ALTER TABLE "NewsletterCampaign" ADD COLUMN     "publishedAt" TIMESTAMP(3);


-- Las campañas ya enviadas por correo pasan al archivo de la web con su fecha de envío.
UPDATE "NewsletterCampaign" SET "publishedAt" = COALESCE("sentAt", "startedAt") WHERE "status" IN ('ENVIADA', 'ENVIANDO');
