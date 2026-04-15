import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();

async function main() {
  console.log("=== QUERY 1: Invoices by company + senderDomain ===");
  const invoices = await db.$queryRaw`
    SELECT company, "senderDomain", COUNT(*)::int as count
    FROM "Invoice"
    GROUP BY company, "senderDomain"
    ORDER BY company NULLS LAST
  `;
  for (const row of invoices) {
    console.log(`  company=${JSON.stringify(row.company)}  senderDomain=${JSON.stringify(row.senderDomain)}  count=${row.count}`);
  }

  console.log("\n=== QUERY 2: Supplier records ===");
  const suppliers = await db.supplier.findMany({ orderBy: { name: "asc" } });
  for (const s of suppliers) {
    console.log(`  name=${JSON.stringify(s.name)}  isRelevant=${s.isRelevant}`);
  }

  await db.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
