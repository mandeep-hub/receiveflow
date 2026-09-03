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

    if (typeof code !== "string" || typeof name !== "string") {
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
  } catch (error) {
    console.error(error);

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

const PORT = 3000;

app.listen(PORT, () => {
  console.log(`ReceiveFlow API running on http://localhost:${PORT}`);
});
