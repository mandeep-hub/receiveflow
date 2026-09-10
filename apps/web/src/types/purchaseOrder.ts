export type PurchaseOrderItem = {
  id: number;
  quantityOrdered: number;
  purchaseOrderId: number;
  productId: number;
  product: {
    id: number;
    articleNumber: string;
    name: string;
    active: boolean;
  };
};

export type PurchaseOrder = {
  id: number;
  poNumber: string;
  orderDate: string;
  expectedDeliveryDate: string;
  status: string;
  source: string;
  externalReference: string | null;
  supplierId: number;
  supplier: {
    id: number;
    code: string;
    name: string;
    active: boolean;
  };
  items: PurchaseOrderItem[];
};
