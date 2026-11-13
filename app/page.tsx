import { readFileSync } from "node:fs";
import { join } from "node:path";

import { InventoryDashboard } from "../src/components/inventory-dashboard";

export default function Home() {
  const sampleCsv = readFileSync(
    join(process.cwd(), "src/data/inventory.csv"),
    "utf8",
  );

  return <InventoryDashboard sampleCsv={sampleCsv} />;
}
