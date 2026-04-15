import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const rows = await db.$queryRaw`
  SELECT company, "senderDomain", COUNT(*)::int AS cnt
  FROM "Invoice"
  GROUP BY company, "senderDomain"
  ORDER BY company NULLS LAST
`;
console.log("=== Invoices by company + senderDomain ===");
console.table(rows);

const suppliers = await db.supplier.findMany({ orderBy: { name: "asc" } });
console.log("\n=== Suppliers ===");
console.table(suppliers.map((s) => ({ name: s.name, isRelevant: s.isRelevant })));

await db.$disconnect();
