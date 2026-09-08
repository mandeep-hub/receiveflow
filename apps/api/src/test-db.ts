import prisma from "./lib/prisma.js";

async function main() {
  const suppliers = await prisma.supplier.findMany();

  console.log("Suppliers:", suppliers);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
