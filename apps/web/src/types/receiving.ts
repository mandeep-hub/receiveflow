export type ReceivingItem = {
  id: number;
  purchaseOrderItemId: number;
  quantityReceived: number;
  reasonCode?:
    | "MISSING_ITEM"
    | "PARTIAL_DELIVERY"
    | "DAMAGED"
    | "QUALITY_ISSUE"
    | "NO_LABEL"
    | "QUALITY_ISSUE_AFTER_RECEIVING"
    | "OTHER"
    | null;

  actionStatus?:
    | "FOLLOW_UP"
    | "CREDIT_REQUEST"
    | "REPLACEMENT_REQUEST"
    | "RETURNED_TO_SUPPLIER"
    | "NO_ACTION"
    | null;
};

export type Receiving = {
  id: number;
  purchaseOrderId: number;
  receivedAt: string;
  items: ReceivingItem[];
};
