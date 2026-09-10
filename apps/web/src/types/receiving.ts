export type ReceivingItem = {
  id: number;
  purchaseOrderItemId: number;
  quantityReceived: number;
  reasonCode?: string | null;
  actionStatus?: string | null;
};

export type Receiving = {
  id: number;
  purchaseOrderId: number;
  receivedAt: string;
  items: ReceivingItem[];
};
