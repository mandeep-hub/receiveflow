-- CreateTable
CREATE TABLE "Receiving" (
    "id" SERIAL NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "purchaseOrderId" INTEGER NOT NULL,

    CONSTRAINT "Receiving_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceivingItem" (
    "id" SERIAL NOT NULL,
    "quantityReceived" INTEGER NOT NULL,
    "reasonCode" TEXT,
    "actionStatus" TEXT,
    "receivingId" INTEGER NOT NULL,
    "purchaseOrderItemId" INTEGER NOT NULL,

    CONSTRAINT "ReceivingItem_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Receiving" ADD CONSTRAINT "Receiving_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceivingItem" ADD CONSTRAINT "ReceivingItem_receivingId_fkey" FOREIGN KEY ("receivingId") REFERENCES "Receiving"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceivingItem" ADD CONSTRAINT "ReceivingItem_purchaseOrderItemId_fkey" FOREIGN KEY ("purchaseOrderItemId") REFERENCES "PurchaseOrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
