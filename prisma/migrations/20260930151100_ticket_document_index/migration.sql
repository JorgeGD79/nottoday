-- Un DNI por evento en entradas nominativas: índice para la comprobación del checkout.
-- CreateIndex
CREATE INDEX "Ticket_eventId_holderDocument_idx" ON "Ticket"("eventId", "holderDocument");
