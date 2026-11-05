// Excel purchase order import: the database checks and the save. The caller
// passes in the Prisma client, so this file doesn't choose a database.
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import {
  groupImportRows,
  readImportRows,
  type GroupedOrder,
  type ImportError,
} from "./importRows.js";

type ImportDb = Pick<Prisma.TransactionClient, "supplier" | "product" | "purchaseOrder">;

type PlannedOrder = Omit<GroupedOrder, "items"> & {
  supplierId: number;
  supplierName: string;
  items: (GroupedOrder["items"][number] & { productId: number; productName: string })[];
};

// The file has errors, so nothing was saved.
export class ImportRejectedError extends Error {
  errors: ImportError[];

  constructor(errors: ImportError[]) {
    super("The file has errors; nothing was saved");
    this.errors = errors;
  }
}

// Another request changed the same data during this import, so nothing was saved.
export class ImportConflictError extends Error {}

// Runs every check, and reports all problems at once.
async function checkImport(
  db: ImportDb,
  body: unknown,
): Promise<{ errors: ImportError[]; plan: PlannedOrder[]; rowCount: number }> {
  const { rows, errors: rowErrors } = readImportRows(body);
  const { orders, errors: groupErrors } = groupImportRows(rows);
  const errors = [...rowErrors, ...groupErrors];

  // One at a time: during an import, these run inside a transaction.
  const suppliers = await db.supplier.findMany({
    where: { code: { in: [...new Set(rows.map((row) => row.supplierCode))] } },
    select: { id: true, code: true, name: true, active: true },
  });
  const products = await db.product.findMany({
    where: { articleNumber: { in: [...new Set(rows.map((row) => row.articleNumber))] } },
    select: { id: true, articleNumber: true, name: true, active: true },
  });
  const existingOrders = await db.purchaseOrder.findMany({
    where: { poNumber: { in: orders.map((order) => order.poNumber) } },
    select: { poNumber: true },
  });

  const supplierByCode = new Map(suppliers.map((supplier) => [supplier.code, supplier]));
  const productByArticle = new Map(products.map((product) => [product.articleNumber, product]));
  const existingPoNumbers = new Set(existingOrders.map((order) => order.poNumber));

  for (const row of rows) {
    const { rowNumber, supplierCode, articleNumber } = row;
    const supplier = supplierByCode.get(supplierCode);
    const product = productByArticle.get(articleNumber);

    if (!supplier) {
      errors.push({ rowNumber, field: "supplierCode", message: `Row ${rowNumber}: supplier "${supplierCode}" was not found` });
    } else if (!supplier.active) {
      errors.push({ rowNumber, field: "supplierCode", message: `Row ${rowNumber}: supplier "${supplierCode}" is inactive` });
    }

    if (!product) {
      errors.push({ rowNumber, field: "articleNumber", message: `Row ${rowNumber}: item "${articleNumber}" was not found` });
    } else if (!product.active) {
      errors.push({ rowNumber, field: "articleNumber", message: `Row ${rowNumber}: item "${articleNumber}" is inactive` });
    }
  }

  for (const order of orders) {
    if (existingPoNumbers.has(order.poNumber)) {
      errors.push({
        rowNumber: order.rowNumber,
        field: "poNumber",
        message: `Row ${order.rowNumber}: PO number "${order.poNumber}" already exists`,
      });
    }
  }

  if (errors.length > 0) {
    // Array.prototype.sort is stable, so one row's errors keep their order.
    return { errors: errors.sort((a, b) => a.rowNumber - b.rowNumber), plan: [], rowCount: rows.length };
  }

  const plan: PlannedOrder[] = orders.map((order) => {
    const supplier = supplierByCode.get(order.supplierCode)!;

    return {
      ...order,
      supplierId: supplier.id,
      supplierName: supplier.name,
      items: order.items.map((item) => {
        const product = productByArticle.get(item.articleNumber)!;

        return { ...item, productId: product.id, productName: product.name };
      }),
    };
  });

  return { errors, plan, rowCount: rows.length };
}

function totalQuantity(order: PlannedOrder) {
  return order.items.reduce((total, item) => total + item.quantityOrdered, 0);
}

function summarize(plan: PlannedOrder[], rows: number) {
  return {
    purchaseOrders: plan.length,
    items: plan.reduce((total, order) => total + order.items.length, 0),
    rows,
    totalQuantity: plan.reduce((total, order) => total + totalQuantity(order), 0),
  };
}

// Checks the rows and saves nothing.
export async function validatePurchaseOrderImport(db: ImportDb, body: unknown) {
  const { errors, plan, rowCount } = await checkImport(db, body);

  if (errors.length > 0) {
    return { valid: false, summary: null, orders: [], errors };
  }

  return {
    valid: true,
    summary: summarize(plan, rowCount),
    orders: plan.map((order) => ({
      poNumber: order.poNumber,
      supplierCode: order.supplierCode,
      supplierName: order.supplierName,
      orderDate: order.orderDate,
      expectedDeliveryDate: order.expectedDeliveryDate,
      items: order.items.map((item) => ({
        articleNumber: item.articleNumber,
        productName: item.productName,
        quantityOrdered: item.quantityOrdered,
        rowNumbers: item.rowNumbers,
      })),
    })),
    errors,
  };
}

// Stored as midnight UTC, like the existing purchase order dates.
function toDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

// Checks everything again and saves every order or none: throwing inside the
// transaction rolls all of it back. The unique PO number is what makes two
// simultaneous imports safe, because the second one fails here and saves nothing.
export async function importPurchaseOrders(db: Pick<PrismaClient, "$transaction">, body: unknown) {
  try {
    return await db.$transaction(
      async (tx) => {
        const { errors, plan, rowCount } = await checkImport(tx, body);

        if (errors.length > 0) {
          throw new ImportRejectedError(errors);
        }

        const imported = [];
        // The same order in every import, so two overlapping imports wait for
        // each other instead of deadlocking.
        const sorted = [...plan].sort((a, b) =>
          a.poNumber < b.poNumber ? -1 : a.poNumber > b.poNumber ? 1 : 0,
        );

        for (const order of sorted) {
          const created = await tx.purchaseOrder.create({
            data: {
              poNumber: order.poNumber,
              supplierId: order.supplierId,
              orderDate: toDate(order.orderDate),
              expectedDeliveryDate: order.expectedDeliveryDate ? toDate(order.expectedDeliveryDate) : null,
              source: "EXCEL",
              items: {
                create: order.items.map((item) => ({
                  productId: item.productId,
                  quantityOrdered: item.quantityOrdered,
                })),
              },
            },
            select: { id: true, poNumber: true },
          });

          imported.push({
            id: created.id,
            poNumber: created.poNumber,
            items: order.items.length,
            totalQuantity: totalQuantity(order),
          });
        }

        return { imported, summary: summarize(plan, rowCount) };
      },
      { timeout: 15_000 },
    );
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;

    // P2002: a PO number now exists. P2003: a supplier or product was removed.
    // P2034: the database refused the transaction because of a write conflict.
    if (code === "P2002" || code === "P2003" || code === "P2034") {
      throw new ImportConflictError("The data changed during this import; nothing was saved. Please validate the file again.");
    }

    throw error;
  }
}
