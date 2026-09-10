import express from "express";
import cors from "cors";
import prisma from "./lib/prisma.js";
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

//Post the receiving

app.post("/receivings", async (req, res) => {
  try {
    const { purchaseOrderId, items } = req.body;

    if (!Number.isInteger(purchaseOrderId) || purchaseOrderId <= 0) {
      return res.status(400).json({
        error: "Valid purchaseOrderId is required",
      });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        error: "At least one receiving item is required",
      });
    }

    const purchaseOrder = await prisma.purchaseOrder.findUnique({
      where: {
        id: purchaseOrderId,
      },
      include: {
        items: true,
      },
    });

    if (!purchaseOrder) {
      return res.status(404).json({
        error: "Purchase order not found",
      });
    }

    for (const item of items) {
      if (
        !Number.isInteger(item.purchaseOrderItemId) ||
        item.purchaseOrderItemId <= 0
      ) {
        return res.status(400).json({
          error: "Each item must have a valid purchaseOrderItemId",
        });
      }

      if (
        !Number.isInteger(item.quantityReceived) ||
        item.quantityReceived <= 0
      ) {
        return res.status(400).json({
          error: "Each item must have a quantityReceived greater than 0",
        });
      }

      const purchaseOrderItem = purchaseOrder.items.find(
        (poItem) => poItem.id === item.purchaseOrderItemId,
      );

      if (
        purchaseOrderItem &&
        item.quantityReceived < purchaseOrderItem.quantityOrdered &&
        !item.reasonCode
      ) {
        return res.status(400).json({
          error: "reasonCode is required for a partial delivery",
        });
      }

      if (!purchaseOrderItem) {
        return res.status(400).json({
          error: "Receiving item does not belong to the purchase order",
        });
      }
      if (
        item.reasonCode !== undefined &&
        item.reasonCode !== null &&
        !RECEIVING_REASON_CODES.includes(item.reasonCode)
      ) {
        return res.status(400).json({
          error: "Invalid reasonCode",
        });
      }
      if (
        item.actionStatus !== undefined &&
        item.actionStatus !== null &&
        !RECEIVING_ACTION_STATUSES.includes(item.actionStatus)
      ) {
        return res.status(400).json({
          error: "Invalid actionStatus",
        });
      }
    }

    const receiving = await prisma.receiving.create({
      data: {
        purchaseOrderId,
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

    const response = {
      ...receiving,
      items: receiving.items.map((item) => {
        const purchaseOrderItem = purchaseOrder.items.find(
          (poItem) => poItem.id === item.purchaseOrderItemId,
        );

        return {
          ...item,
          difference: purchaseOrderItem
            ? item.quantityReceived - purchaseOrderItem.quantityOrdered
            : null,
        };
      }),
    };

    return res.status(201).json(response);
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error: "Failed to create receiving record",
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

    res.json(receiving);
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
