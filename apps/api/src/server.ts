import express from "express";
import cors from "cors";
import prisma from "./lib/prisma.js";
import type { Prisma } from "./generated/prisma/client.js";
const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    name: "ReceiveFlow API",
    status: "running",
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
  });
});

app.get("/suppliers", async (req, res) => {
  const suppliers = await prisma.supplier.findMany();

  res.json(suppliers);
});

app.post("/suppliers", async (req, res) => {
  try {
    const { code, name } = req.body;

    if (
      typeof code !== "string" ||
      typeof name !== "string" ||
      code.trim() === "" ||
      name.trim() === ""
    ) {
      return res.status(400).json({
        error: "Code and name are required",
      });
    }

    const supplier = await prisma.supplier.create({
      data: {
        code: code.trim(),
        name: name.trim(),
      },
    });

    res.status(201).json(supplier);
  } catch (error: any) {
    console.error(error);

    if (error.code === "P2002") {
      return res.status(409).json({
        error: "Supplier code already exists",
      });
    }

    res.status(500).json({
      error: "Failed to create supplier",
    });
  }
});
app.get("/suppliers/:id", async (req, res) => {
  const supplier = await prisma.supplier.findUnique({
    where: {
      id: Number(req.params.id),
    },
  });

  if (!supplier) {
    return res.status(404).json({ error: "Supplier not found" });
  }
  res.json(supplier);
});

app.put("/suppliers/:id", async (req, res) => {
  const supplier = await prisma.supplier.findUnique({
    where: {
      id: Number(req.params.id),
    },
  });

  if (!supplier) {
    return res.status(404).json({
      error: "Supplier not found",
    });
  }

  const updatedSupplier = await prisma.supplier.update({
    where: {
      id: Number(req.params.id),
    },
    data: {
      name: req.body.name,
      active: req.body.active,
    },
  });

  res.json(updatedSupplier);
});
app.delete("/suppliers/:id", async (req, res) => {
  const supplier = await prisma.supplier.findUnique({
    where: {
      id: Number(req.params.id),
    },
  });

  if (!supplier) {
    return res.status(404).json({
      error: "Supplier not found",
    });
  }

  await prisma.supplier.delete({
    where: {
      id: Number(req.params.id),
    },
  });

  res.status(200).json({
    message: `Supplier ${supplier.code} has been deleted`,
  });
});

app.get("/products", async (req, res) => {
  const products = await prisma.product.findMany();

  res.json(products);
});

app.get("/products/:id", async (req, res) => {
  const product = await prisma.product.findUnique({
    where: {
      id: Number(req.params.id),
    },
  });

  if (!product) {
    return res.status(404).json({
      error: "Product not found",
    });
  }

  res.json(product);
});

app.post("/products", async (req, res) => {
  try {
    const { articleNumber, name } = req.body;

    if (
      typeof articleNumber !== "string" ||
      typeof name !== "string" ||
      articleNumber.trim() === "" ||
      name.trim() === ""
    ) {
      return res.status(400).json({
        error: "Article number and name are required",
      });
    }

    const product = await prisma.product.create({
      data: {
        articleNumber: articleNumber.trim(),
        name: name.trim(),
      },
    });

    res.status(201).json(product);
  } catch (error: any) {
    console.error(error);

    if (error.code === "P2002") {
      return res.status(409).json({
        error: "Article number already exists",
      });
    }

    res.status(500).json({
      error: "Failed to create product",
    });
  }
});

app.put("/products/:id", async (req, res) => {
  const product = await prisma.product.findUnique({
    where: {
      id: Number(req.params.id),
    },
  });

  if (!product) {
    return res.status(404).json({
      error: "Product not found",
    });
  }

  const updatedProduct = await prisma.product.update({
    where: {
      id: Number(req.params.id),
    },
    data: {
      name: req.body.name,
      active: req.body.active,
    },
  });

  res.json(updatedProduct);
});

app.delete("/products/:id", async (req, res) => {
  const product = await prisma.product.findUnique({
    where: {
      id: Number(req.params.id),
    },
  });

  if (!product) {
    return res.status(404).json({
      error: "Product not found",
    });
  }

  const updatedProduct = await prisma.product.update({
    where: {
      id: Number(req.params.id),
    },
    data: {
      active: false,
    },
  });

  res.json(updatedProduct);
});

//Purchase order endpoint

app.post("/purchase-orders", async (req, res) => {
  try {
    const { poNumber, supplierId, orderDate, expectedDeliveryDate, items } =
      req.body;

    // Basic PO validation
    if (typeof poNumber !== "string" || poNumber.trim() === "") {
      return res.status(400).json({
        error: "PO number is required",
      });
    }

    if (!Number.isInteger(supplierId) || supplierId <= 0) {
      return res.status(400).json({
        error: "Valid supplierId is required",
      });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        error: "At least one purchase order item is required",
      });
    }

    // Validate dates
    const parsedOrderDate = new Date(orderDate);

    if (
      typeof orderDate !== "string" ||
      Number.isNaN(parsedOrderDate.getTime())
    ) {
      return res.status(400).json({
        error: "Valid orderDate is required",
      });
    }

    let parsedExpectedDeliveryDate: Date | undefined;

    if (expectedDeliveryDate !== undefined && expectedDeliveryDate !== null) {
      parsedExpectedDeliveryDate = new Date(expectedDeliveryDate);

      if (Number.isNaN(parsedExpectedDeliveryDate.getTime())) {
        return res.status(400).json({
          error: "Invalid expectedDeliveryDate",
        });
      }
    }

    // Validate supplier exists
    const supplier = await prisma.supplier.findUnique({
      where: {
        id: supplierId,
      },
    });

    if (!supplier) {
      return res.status(404).json({
        error: "Supplier not found",
      });
    }
    if (!supplier.active) {
      return res.status(400).json({
        error: "Supplier is inactive",
      });
    }

    // Validate each PO item
    for (const item of items) {
      if (!Number.isInteger(item.productId) || item.productId <= 0) {
        return res.status(400).json({
          error: "Each item must have a valid productId",
        });
      }

      if (
        !Number.isInteger(item.quantityOrdered) ||
        item.quantityOrdered <= 0
      ) {
        return res.status(400).json({
          error: "Each item must have a quantityOrdered greater than 0",
        });
      }
    }

    // Make sure all products exist
    const productIds = items.map((item: any) => item.productId);

    const products = await prisma.product.findMany({
      where: {
        id: {
          in: productIds,
        },
      },
    });

    if (products.length !== new Set(productIds).size) {
      return res.status(404).json({
        error: "One or more products were not found",
      });
    }
    // Make sure all products are active
    const inactiveProduct = products.find((product) => !product.active);

    if (inactiveProduct) {
      return res.status(400).json({
        error: `Product ${inactiveProduct.articleNumber} is inactive`,
      });
    }

    // Create the PO and its items
    const purchaseOrder = await prisma.purchaseOrder.create({
      data: {
        poNumber: poNumber.trim(),
        supplierId,
        orderDate: parsedOrderDate,
        expectedDeliveryDate: parsedExpectedDeliveryDate,
        items: {
          create: items.map((item: any) => ({
            productId: item.productId,
            quantityOrdered: item.quantityOrdered,
          })),
        },
      },
      include: {
        supplier: true,
        items: {
          include: {
            product: true,
          },
        },
      },
    });

    return res.status(201).json(purchaseOrder);
  } catch (error: any) {
    console.error(error);

    if (error.code === "P2002") {
      return res.status(409).json({
        error: "PO number already exists",
      });
    }

    return res.status(500).json({
      error: "Failed to create purchase order",
    });
  }
});

//Get purchase order

app.get("/purchase-orders", async (req, res) => {
  try {
    const purchaseOrders = await prisma.purchaseOrder.findMany({
      include: {
        supplier: true,
        items: {
          include: {
            product: true,
          },
        },
      },
      orderBy: {
        orderDate: "desc",
      },
    });

    res.json(purchaseOrders);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Failed to fetch purchase orders",
    });
  }
});

//Get PO by id

app.get("/purchase-orders/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({
        error: "Invalid purchase order id",
      });
    }

    const purchaseOrder = await prisma.purchaseOrder.findUnique({
      where: {
        id,
      },
      include: {
        supplier: true,
        items: {
          include: {
            product: true,
          },
        },
      },
    });

    if (!purchaseOrder) {
      return res.status(404).json({
        error: "Purchase order not found",
      });
    }

    res.json(purchaseOrder);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Failed to fetch purchase order",
    });
  }
});

//Receiving endpoint
const RECEIVING_REASON_CODES = [
  "MISSING_ITEM",
  "PARTIAL_DELIVERY",
  "DAMAGED",
  "QUALITY_ISSUE",
  "NO_LABEL",
  "QUALITY_ISSUE_AFTER_RECEIVING",
  "OTHER",
] as const;

const RECEIVING_ACTION_STATUSES = [
  "FOLLOW_UP",
  "CREDIT_REQUEST",
  "REPLACEMENT_REQUEST",
  "RETURNED_TO_SUPPLIER",
  "NO_ACTION",
] as const;

const RECEIVABLE_PURCHASE_ORDER_STATUSES = ["OPEN", "PARTIALLY_RECEIVED"];

// Set deliberately; received quantities must not override them.
const FIXED_PURCHASE_ORDER_STATUSES = ["DRAFT", "CANCELLED"];

// Thrown inside a transaction to roll it back and return an HTTP error.
class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// Locks the PO row until the transaction ends, so receivings and status
// recalculations for the same PO run one at a time. Returns false if the
// PO does not exist.
async function lockPurchaseOrder(
  db: Prisma.TransactionClient,
  purchaseOrderId: number,
) {
  const lockedRows = await db.$queryRaw<{ id: number }[]>`
    SELECT id FROM "PurchaseOrder" WHERE id = ${purchaseOrderId} FOR UPDATE
  `;

  return lockedRows.length > 0;
}

async function updatePurchaseOrderStatus(
  db: Prisma.TransactionClient,
  purchaseOrderId: number,
) {
  const purchaseOrder = await db.purchaseOrder.findUnique({
    where: {
      id: purchaseOrderId,
    },
    include: {
      items: true,
    },
  });

  if (!purchaseOrder) {
    return;
  }

  if (FIXED_PURCHASE_ORDER_STATUSES.includes(purchaseOrder.status)) {
    return;
  }

  const receivings = await db.receiving.findMany({
    where: {
      purchaseOrderId,
    },
    include: {
      items: true,
    },
  });

  const totalReceivedByItem = new Map<number, number>();

  for (const receiving of receivings) {
    for (const receivingItem of receiving.items) {
      const currentQuantity =
        totalReceivedByItem.get(receivingItem.purchaseOrderItemId) ?? 0;

      totalReceivedByItem.set(
        receivingItem.purchaseOrderItemId,
        currentQuantity + receivingItem.quantityReceived,
      );
    }
  }

  const allItemsReceived = purchaseOrder.items.every((purchaseOrderItem) => {
    const totalReceived = totalReceivedByItem.get(purchaseOrderItem.id) ?? 0;

    return totalReceived >= purchaseOrderItem.quantityOrdered;
  });

  const anyItemReceived = purchaseOrder.items.some((purchaseOrderItem) => {
    const totalReceived = totalReceivedByItem.get(purchaseOrderItem.id) ?? 0;

    return totalReceived > 0;
  });

  const newStatus = allItemsReceived
    ? "RECEIVED"
    : anyItemReceived
      ? "PARTIALLY_RECEIVED"
      : "OPEN";

  await db.purchaseOrder.update({
    where: {
      id: purchaseOrderId,
    },
    data: {
      status: newStatus,
    },
  });
}

//Post the receiving

app.post("/receivings", async (req, res) => {
  try {
    const { purchaseOrderId, epCount, items } = req.body;

    if (!Number.isInteger(purchaseOrderId) || purchaseOrderId <= 0) {
      return res.status(400).json({
        error: "Valid purchaseOrderId is required",
      });
    }

    if (!Number.isInteger(epCount) || epCount < 0) {
      return res.status(400).json({
        error: "Valid epCount is required",
      });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        error: "At least one receiving item is required",
      });
    }

    // Validate, create the receiving and update the PO status atomically.
    const { receiving, purchaseOrder, previouslyReceivedByItem } =
      await prisma.$transaction(
        async (tx) => {
          // Lock the PO row so concurrent receivings for the same PO run
          // one at a time and always see each other's committed quantities.
          if (!(await lockPurchaseOrder(tx, purchaseOrderId))) {
            throw new HttpError(404, "Purchase order not found");
          }

          const purchaseOrder = await tx.purchaseOrder.findUnique({
            where: {
              id: purchaseOrderId,
            },
            include: {
              items: true,
            },
          });

          if (!purchaseOrder) {
            throw new HttpError(404, "Purchase order not found");
          }

          if (
            !RECEIVABLE_PURCHASE_ORDER_STATUSES.includes(purchaseOrder.status)
          ) {
            throw new HttpError(
              409,
              `Purchase order is not open for receiving (status: ${purchaseOrder.status})`,
            );
          }

          // Get all previous receiving records for this purchase order.
          const previousReceivings = await tx.receiving.findMany({
            where: {
              purchaseOrderId,
            },
            include: {
              items: true,
            },
          });

          // Calculate the total quantity previously received for each PO item.
          const previouslyReceivedByItem = new Map<number, number>();

          for (const receiving of previousReceivings) {
            for (const receivingItem of receiving.items) {
              const currentQuantity =
                previouslyReceivedByItem.get(
                  receivingItem.purchaseOrderItemId,
                ) ?? 0;

              previouslyReceivedByItem.set(
                receivingItem.purchaseOrderItemId,
                currentQuantity + receivingItem.quantityReceived,
              );
            }
          }

          const seenPurchaseOrderItemIds = new Set<number>();

          // Validate each receiving item.
          for (const item of items) {
            if (
              !Number.isInteger(item.purchaseOrderItemId) ||
              item.purchaseOrderItemId <= 0
            ) {
              throw new HttpError(
                400,
                "Each item must have a valid purchaseOrderItemId",
              );
            }

            // Each PO item may appear only once, otherwise the remaining
            // quantity check below would be bypassed.
            if (seenPurchaseOrderItemIds.has(item.purchaseOrderItemId)) {
              throw new HttpError(
                400,
                `Duplicate purchaseOrderItemId ${item.purchaseOrderItemId} in request`,
              );
            }

            seenPurchaseOrderItemIds.add(item.purchaseOrderItemId);

            if (
              !Number.isInteger(item.quantityReceived) ||
              item.quantityReceived <= 0
            ) {
              throw new HttpError(
                400,
                "Each item must have a quantityReceived greater than 0",
              );
            }

            const purchaseOrderItem = purchaseOrder.items.find(
              (poItem) => poItem.id === item.purchaseOrderItemId,
            );

            if (!purchaseOrderItem) {
              throw new HttpError(
                400,
                "Receiving item does not belong to the purchase order",
              );
            }

            const previouslyReceived =
              previouslyReceivedByItem.get(item.purchaseOrderItemId) ?? 0;

            const remainingQuantity =
              purchaseOrderItem.quantityOrdered - previouslyReceived;

            // Do not allow receiving more than the remaining quantity.
            if (item.quantityReceived > remainingQuantity) {
              throw new HttpError(
                400,
                `Quantity received exceeds the remaining quantity for purchase order item ${item.purchaseOrderItemId}`,
              );
            }

            // A delivery is partial when it is less than the quantity
            // still remaining on the purchase order item.
            if (item.quantityReceived < remainingQuantity && !item.reasonCode) {
              throw new HttpError(
                400,
                "reasonCode is required for a partial delivery",
              );
            }

            if (
              item.reasonCode !== undefined &&
              item.reasonCode !== null &&
              !RECEIVING_REASON_CODES.includes(item.reasonCode)
            ) {
              throw new HttpError(400, "Invalid reasonCode");
            }

            if (
              item.actionStatus !== undefined &&
              item.actionStatus !== null &&
              !RECEIVING_ACTION_STATUSES.includes(item.actionStatus)
            ) {
              throw new HttpError(400, "Invalid actionStatus");
            }
          }

          const receiving = await tx.receiving.create({
            data: {
              purchaseOrderId,
              epCount,
              items: {
                create: items.map((item: any) => ({
                  purchaseOrderItemId: item.purchaseOrderItemId,
                  quantityReceived: item.quantityReceived,
                  reasonCode: item.reasonCode ?? null,
                  actionStatus: item.actionStatus ?? null,
                })),
              },
            },
            include: {
              purchaseOrder: true,
              items: true,
            },
          });

          await updatePurchaseOrderStatus(tx, purchaseOrderId);

          return { receiving, purchaseOrder, previouslyReceivedByItem };
        },
        {
          maxWait: 5000,
          timeout: 10000,
        },
      );

    const response = {
      ...receiving,
      items: receiving.items.map((item) => {
        const purchaseOrderItem = purchaseOrder.items.find(
          (poItem) => poItem.id === item.purchaseOrderItemId,
        );

        const previouslyReceived =
          previouslyReceivedByItem.get(item.purchaseOrderItemId) ?? 0;

        const totalReceived = previouslyReceived + item.quantityReceived;

        return {
          ...item,
          totalReceived,
          remainingQuantity: purchaseOrderItem
            ? purchaseOrderItem.quantityOrdered - totalReceived
            : null,
          difference: purchaseOrderItem
            ? totalReceived - purchaseOrderItem.quantityOrdered
            : null,
        };
      }),
    };

    return res.status(201).json(response);
  } catch (error: any) {
    if (error instanceof HttpError) {
      return res.status(error.status).json({
        error: error.message,
      });
    }

    console.error(error);

    // P2028: the transaction could not start or timed out (e.g. waiting
    // for the PO lock). It has been rolled back, so a retry is safe.
    if (error.code === "P2028") {
      return res.status(503).json({
        error: "Receiving is busy, please try again",
      });
    }

    return res.status(500).json({
      error: "Failed to create receiving record",
    });
  }
});
app.post("/purchase-orders/:id/recalculate-status", async (req, res) => {
  try {
    const purchaseOrderId = Number(req.params.id);

    if (!Number.isInteger(purchaseOrderId) || purchaseOrderId <= 0) {
      return res.status(400).json({
        error: "Valid purchase order id is required",
      });
    }

    // Lock the PO first so the recalculation can't interleave with a
    // receiving transaction and write a stale status.
    const status = await prisma.$transaction(
      async (tx) => {
        if (!(await lockPurchaseOrder(tx, purchaseOrderId))) {
          throw new HttpError(404, "Purchase order not found");
        }

        await updatePurchaseOrderStatus(tx, purchaseOrderId);

        const updatedPurchaseOrder = await tx.purchaseOrder.findUnique({
          where: {
            id: purchaseOrderId,
          },
        });

        return updatedPurchaseOrder?.status;
      },
      {
        maxWait: 5000,
        timeout: 10000,
      },
    );

    return res.status(200).json({
      message: "Purchase order status recalculated",
      status,
    });
  } catch (error: any) {
    if (error instanceof HttpError) {
      return res.status(error.status).json({
        error: error.message,
      });
    }

    console.error(error);

    if (error.code === "P2028") {
      return res.status(503).json({
        error: "Purchase order is busy, please try again",
      });
    }

    return res.status(500).json({
      error: "Failed to recalculate purchase order status",
    });
  }
});

// Get receiving records

app.get("/receivings", async (req, res) => {
  try {
    const receivings = await prisma.receiving.findMany({
      include: {
        purchaseOrder: {
          include: {
            supplier: true,
            items: {
              include: {
                product: true,
              },
            },
          },
        },
        items: {
          include: {
            purchaseOrderItem: {
              include: {
                product: true,
              },
            },
          },
        },
      },
      orderBy: {
        receivedAt: "desc",
      },
    });

    const response = receivings.map((receiving) => ({
      ...receiving,
      items: receiving.items.map((item) => ({
        ...item,
        difference:
          item.quantityReceived - item.purchaseOrderItem.quantityOrdered,
      })),
    }));

    res.json(response);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Failed to fetch receiving records",
    });
  }
});

// Get end-of-day receiving report
app.get("/receivings/report", async (req, res) => {
  try {
    const date = String(req.query.date ?? "");

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({
        error: "Valid date is required in YYYY-MM-DD format",
      });
    }

    const startDate = new Date(`${date}T00:00:00.000Z`);
    const endDate = new Date(`${date}T23:59:59.999Z`);

    const receivings = await prisma.receiving.findMany({
      where: {
        receivedAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      include: {
        purchaseOrder: {
          include: {
            supplier: true,
          },
        },
        items: {
          include: {
            purchaseOrderItem: {
              include: {
                product: true,
              },
            },
          },
        },
      },
      orderBy: {
        receivedAt: "asc",
      },
    });

    const allPreviousReceivings = await prisma.receiving.findMany({
      where: {
        receivedAt: {
          lt: startDate,
        },
      },
      include: {
        items: true,
      },
    });

    const previousReceivedByItem = new Map<number, number>();

    for (const receiving of allPreviousReceivings) {
      for (const item of receiving.items) {
        const currentQuantity =
          previousReceivedByItem.get(item.purchaseOrderItemId) ?? 0;

        previousReceivedByItem.set(
          item.purchaseOrderItemId,
          currentQuantity + item.quantityReceived,
        );
      }
    }

    const reportRows = receivings.flatMap((receiving) =>
      receiving.items.map((item) => {
        const quantityOrdered = item.purchaseOrderItem.quantityOrdered;

        const previouslyReceived =
          previousReceivedByItem.get(item.purchaseOrderItemId) ?? 0;

        const remainingQuantity = Math.max(
          quantityOrdered - previouslyReceived,
          0,
        );

        const difference = item.quantityReceived - remainingQuantity;

        const totalReceived = previouslyReceived + item.quantityReceived;

        previousReceivedByItem.set(item.purchaseOrderItemId, totalReceived);

        return {
          receivingId: receiving.id,
          receivedAt: receiving.receivedAt,
          purchaseOrderId: receiving.purchaseOrderId,
          poNumber: receiving.purchaseOrder.poNumber,
          supplier: receiving.purchaseOrder.supplier.name,
          purchaseOrderItemId: item.purchaseOrderItemId,
          articleNumber: item.purchaseOrderItem.product.articleNumber,
          product: item.purchaseOrderItem.product.name,
          quantityOrdered,
          previouslyReceived,
          quantityReceived: item.quantityReceived,
          remainingQuantity,
          difference,
          reasonCode: item.reasonCode,
          actionStatus: item.actionStatus,
          epCount: receiving.epCount,
        };
      }),
    );
    const totalPurchaseOrders = new Set(
      reportRows.map((row) => row.purchaseOrderId),
    ).size;

    const totalItems = reportRows.length;

    const totalDelivered = reportRows.reduce(
      (total, row) => total + row.quantityReceived,
      0,
    );

    const totalEpKasser = receivings.reduce(
      (total, receiving) => total + receiving.epCount,
      0,
    );

    const totalDiscrepancies = reportRows.filter(
      (row) => row.difference !== 0,
    ).length;

    return res.status(200).json({
      date,
      summary: {
        totalPurchaseOrders,
        totalItems,
        totalDelivered,
        totalEpKasser,
        totalDiscrepancies,
      },
      rows: reportRows,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error: "Failed to generate end-of-day receiving report",
    });
  }
});

//Get a receiving by id
app.get("/receivings/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({
        error: "Invalid receiving id",
      });
    }

    const receiving = await prisma.receiving.findUnique({
      where: {
        id,
      },
      include: {
        purchaseOrder: {
          include: {
            supplier: true,
          },
        },
        items: {
          include: {
            purchaseOrderItem: {
              include: {
                product: true,
              },
            },
          },
        },
      },
    });

    if (!receiving) {
      return res.status(404).json({
        error: "Receiving record not found",
      });
    }

    const response = {
      ...receiving,
      items: receiving.items.map((item) => ({
        ...item,
        difference:
          item.quantityReceived - item.purchaseOrderItem.quantityOrdered,
      })),
    };

    res.json(response);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Failed to fetch receiving record",
    });
  }
});

const PORT = 3000;

app.listen(PORT, () => {
  console.log(`ReceiveFlow API running on http://localhost:${PORT}`);
});
