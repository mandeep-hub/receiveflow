import express from "express";
//import cors from "cors";
import prisma from "./lib/prisma";
const app = express();

//app.use(cors());
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
const PORT = 3000;

app.listen(PORT, () => {
  console.log(`ReceiveFlow API running on http://localhost:${PORT}`);
});
