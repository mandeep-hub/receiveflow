// Test records for database-backed tests: a unique run tag, a list of every
// record this run creates, and a cleanup that deletes only those records.
//
// Cleanup is all-or-nothing. It runs in one transaction, first verifies that
// every tracked row still carries this run's tag and that nothing outside the
// run depends on them, and then deletes by exact id. If any check or delete
// count doesn't match, it throws, the transaction rolls back and nothing is
// deleted.
import { randomBytes } from "node:crypto";
import type { getTestDatabase } from "./db.ts";

export type TestDatabase = Awaited<ReturnType<typeof getTestDatabase>>;

const TAG_PATTERN = /^TEST-RCV-[0-9a-z]+-[0-9a-f]{8}$/;

export type TrackedRecords = {
  tag: string;
  supplierIds: number[];
  productIds: number[];
  purchaseOrderIds: number[];
  receivingIds: number[];
};

export function createTracker(): TrackedRecords {
  const tag = `TEST-RCV-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;

  return { tag, supplierIds: [], productIds: [], purchaseOrderIds: [], receivingIds: [] };
}

// Records a receiving the API created, so cleanup knows it belongs to this run.
export function trackReceiving(tracker: TrackedRecords, response: { status: number; body: any }) {
  if (response.status === 201 && Number.isInteger(response.body?.id)) {
    tracker.receivingIds.push(response.body.id);
  }
}

export async function createSupplier(db: TestDatabase, tracker: TrackedRecords) {
  const supplier = await db.supplier.create({
    data: { code: tracker.tag, name: `${tracker.tag} Supplier` },
  });
  tracker.supplierIds.push(supplier.id);

  return supplier;
}

export async function createProduct(db: TestDatabase, tracker: TrackedRecords) {
  const product = await db.product.create({
    data: { articleNumber: tracker.tag, name: `${tracker.tag} Product` },
  });
  tracker.productIds.push(product.id);

  return product;
}

export type PurchaseOrderStatus =
  | "DRAFT"
  | "OPEN"
  | "PARTIALLY_RECEIVED"
  | "RECEIVED"
  | "CANCELLED";

// A purchase order with a single item. It is OPEN unless `status` is given
// (no API route can set DRAFT or CANCELLED, so tests set it here directly).
export async function createPurchaseOrder(
  db: TestDatabase,
  tracker: TrackedRecords,
  options: {
    suffix: string;
    supplierId: number;
    productId: number;
    quantityOrdered: number;
    status?: PurchaseOrderStatus;
  },
) {
  const purchaseOrder = await db.purchaseOrder.create({
    data: {
      poNumber: `${tracker.tag}-${options.suffix}`,
      orderDate: new Date(),
      supplierId: options.supplierId,
      ...(options.status ? { status: options.status } : {}),
      items: {
        create: [{ productId: options.productId, quantityOrdered: options.quantityOrdered }],
      },
    },
    include: { items: true },
  });
  tracker.purchaseOrderIds.push(purchaseOrder.id);

  return { id: purchaseOrder.id, itemId: purchaseOrder.items[0].id };
}

function sameIds(actual: number[], expected: number[]) {
  const a = [...actual].sort((x, y) => x - y);
  const e = [...expected].sort((x, y) => x - y);

  return a.length === e.length && a.every((value, index) => value === e[index]);
}

function stop(reason: string): never {
  throw new Error(`[test cleanup] Nothing deleted: ${reason}`);
}

export async function cleanupTrackedRecords(db: TestDatabase, tracker: TrackedRecords) {
  const { tag, supplierIds, productIds, purchaseOrderIds, receivingIds } = tracker;

  if (!TAG_PATTERN.test(tag)) {
    stop("the run tag has an unexpected format");
  }

  if (
    supplierIds.length + productIds.length + purchaseOrderIds.length + receivingIds.length ===
    0
  ) {
    return { deleted: "nothing to clean up" };
  }

  return db.$transaction(async (tx) => {
    // 1. Every tracked row must still exist and carry this run's tag.
    const suppliers = await tx.supplier.findMany({ where: { id: { in: supplierIds } } });
    if (suppliers.length !== supplierIds.length || suppliers.some((s) => s.code !== tag)) {
      stop("a tracked supplier is missing or not tagged for this run");
    }

    const products = await tx.product.findMany({ where: { id: { in: productIds } } });
    if (products.length !== productIds.length || products.some((p) => p.articleNumber !== tag)) {
      stop("a tracked product is missing or not tagged for this run");
    }

    const purchaseOrders = await tx.purchaseOrder.findMany({
      where: { id: { in: purchaseOrderIds } },
    });
    if (
      purchaseOrders.length !== purchaseOrderIds.length ||
      purchaseOrders.some(
        (po) => !po.poNumber.startsWith(`${tag}-`) || !supplierIds.includes(po.supplierId),
      )
    ) {
      stop("a tracked purchase order is missing or not tagged for this run");
    }

    // 2. The receivings on our purchase orders must be exactly the tracked ones.
    const receivings = await tx.receiving.findMany({
      where: { purchaseOrderId: { in: purchaseOrderIds } },
      select: { id: true },
    });
    if (!sameIds(receivings.map((r) => r.id), receivingIds)) {
      stop("the receivings on the test purchase orders don't match the tracked list");
    }

    const trackedReceivings = await tx.receiving.findMany({
      where: { id: { in: receivingIds } },
      select: { id: true, purchaseOrderId: true },
    });
    if (
      trackedReceivings.length !== receivingIds.length ||
      trackedReceivings.some((r) => !purchaseOrderIds.includes(r.purchaseOrderId))
    ) {
      stop("a tracked receiving doesn't belong to a test purchase order");
    }

    // 3. Nothing outside this run may depend on the rows we are about to delete.
    const purchaseOrderItems = await tx.purchaseOrderItem.findMany({
      where: { purchaseOrderId: { in: purchaseOrderIds } },
      select: { id: true, productId: true },
    });
    const purchaseOrderItemIds = purchaseOrderItems.map((item) => item.id);

    if (purchaseOrderItems.some((item) => !productIds.includes(item.productId))) {
      stop("a test purchase order has an item for a product outside this run");
    }

    const [foreignReceivingItems, foreignProductUses, foreignSupplierUses] = await Promise.all([
      tx.receivingItem.count({
        where: {
          purchaseOrderItemId: { in: purchaseOrderItemIds },
          receivingId: { notIn: receivingIds },
        },
      }),
      tx.purchaseOrderItem.count({
        where: { productId: { in: productIds }, purchaseOrderId: { notIn: purchaseOrderIds } },
      }),
      tx.purchaseOrder.count({
        where: { supplierId: { in: supplierIds }, id: { notIn: purchaseOrderIds } },
      }),
    ]);
    if (foreignReceivingItems + foreignProductUses + foreignSupplierUses !== 0) {
      stop("records outside this run refer to the test records");
    }

    const receivingItemCount = await tx.receivingItem.count({
      where: { receivingId: { in: receivingIds } },
    });

    // 4. Delete by exact id, children before parents, checking every count.
    const expectCount = (label: string, actual: number, expected: number) => {
      if (actual !== expected) {
        stop(`expected to delete ${expected} ${label}, matched ${actual}`);
      }
    };

    const deletedReceivingItems = await tx.receivingItem.deleteMany({
      where: { receivingId: { in: receivingIds } },
    });
    expectCount("receiving items", deletedReceivingItems.count, receivingItemCount);

    const deletedReceivings = await tx.receiving.deleteMany({
      where: { id: { in: receivingIds }, purchaseOrderId: { in: purchaseOrderIds } },
    });
    expectCount("receivings", deletedReceivings.count, receivingIds.length);

    const deletedItems = await tx.purchaseOrderItem.deleteMany({
      where: { id: { in: purchaseOrderItemIds }, purchaseOrderId: { in: purchaseOrderIds } },
    });
    expectCount("purchase order items", deletedItems.count, purchaseOrderItemIds.length);

    const deletedPurchaseOrders = await tx.purchaseOrder.deleteMany({
      where: { id: { in: purchaseOrderIds }, poNumber: { startsWith: `${tag}-` } },
    });
    expectCount("purchase orders", deletedPurchaseOrders.count, purchaseOrderIds.length);

    const deletedProducts = await tx.product.deleteMany({
      where: { id: { in: productIds }, articleNumber: tag },
    });
    expectCount("products", deletedProducts.count, productIds.length);

    const deletedSuppliers = await tx.supplier.deleteMany({
      where: { id: { in: supplierIds }, code: tag },
    });
    expectCount("suppliers", deletedSuppliers.count, supplierIds.length);

    return {
      deleted: {
        receivingItems: deletedReceivingItems.count,
        receivings: deletedReceivings.count,
        purchaseOrderItems: deletedItems.count,
        purchaseOrders: deletedPurchaseOrders.count,
        products: deletedProducts.count,
        suppliers: deletedSuppliers.count,
      },
    };
  }, { timeout: 15_000 });
}
