import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const items = [
  // ── Payment ──────────────────────────────────────────────────────────────
  { item: "payment",           majorHead: "Payment",     subHead: "Agency"     },

  // ── Adjustments ───────────────────────────────────────────────────────────
  { item: "adjust",            majorHead: "Adjustments", subHead: "Adjustments" },
  { item: "write-off",         majorHead: "Adjustments", subHead: "Adjustments" },
  { item: "write off",         majorHead: "Adjustments", subHead: "Adjustments" },
  { item: "writeoff",          majorHead: "Adjustments", subHead: "Adjustments" },
  { item: "reclass",           majorHead: "Adjustments", subHead: "Adjustments" },
  { item: "correction",        majorHead: "Adjustments", subHead: "Adjustments" },

  // ── Billing: Discount ─────────────────────────────────────────────────────
  { item: "discount",          majorHead: "Billing",     subHead: "Discount"   },
  { item: "scholarship",       majorHead: "Billing",     subHead: "Discount"   },
  { item: "sibling",           majorHead: "Billing",     subHead: "Discount"   },
  { item: "waiver",            majorHead: "Billing",     subHead: "Discount"   },

  // ── Billing: Agency ───────────────────────────────────────────────────────
  { item: "agency",            majorHead: "Billing",     subHead: "Agency"     },
  { item: "copay",             majorHead: "Billing",     subHead: "Agency"     },
  { item: "co-pay",            majorHead: "Billing",     subHead: "Agency"     },
  { item: "contribution",      majorHead: "Billing",     subHead: "Agency"     },
  { item: "subsidy",           majorHead: "Billing",     subHead: "Agency"     },
  { item: "voucher",           majorHead: "Billing",     subHead: "Agency"     },
  { item: "circuit",           majorHead: "Billing",     subHead: "Agency"     },
  { item: "ccap",              majorHead: "Billing",     subHead: "Agency"     },
  { item: " des ",             majorHead: "Billing",     subHead: "Agency"     },
  { item: " acs ",             majorHead: "Billing",     subHead: "Agency"     },
  { item: " doe ",             majorHead: "Billing",     subHead: "Agency"     },
  { item: "upk",               majorHead: "Billing",     subHead: "Agency"     },
  { item: "3k",                majorHead: "Billing",     subHead: "Agency"     },
  { item: "nyc doe",           majorHead: "Billing",     subHead: "Agency"     },

  // ── Billing: Early/Late ───────────────────────────────────────────────────
  { item: "early am",          majorHead: "Billing",     subHead: "Early/Late" },
  { item: "late pm",           majorHead: "Billing",     subHead: "Early/Late" },
  { item: "am care",           majorHead: "Billing",     subHead: "Early/Late" },
  { item: "pm care",           majorHead: "Billing",     subHead: "Early/Late" },
  { item: "before care",       majorHead: "Billing",     subHead: "Early/Late" },
  { item: "after care",        majorHead: "Billing",     subHead: "Early/Late" },
  { item: "after school",      majorHead: "Billing",     subHead: "Early/Late" },
  { item: "extended",          majorHead: "Billing",     subHead: "Early/Late" },
  { item: "early drop",        majorHead: "Billing",     subHead: "Early/Late" },
  { item: "late pickup",       majorHead: "Billing",     subHead: "Early/Late" },
  { item: "late pick",         majorHead: "Billing",     subHead: "Early/Late" },

  // ── Billing: One Time ─────────────────────────────────────────────────────
  { item: "registration",      majorHead: "Billing",     subHead: "One Time"   },
  { item: "enrollment fee",    majorHead: "Billing",     subHead: "One Time"   },
  { item: "activity",          majorHead: "Billing",     subHead: "One Time"   },
  { item: "supply",            majorHead: "Billing",     subHead: "One Time"   },
  { item: "material",          majorHead: "Billing",     subHead: "One Time"   },
  { item: "one time",          majorHead: "Billing",     subHead: "One Time"   },
  { item: "one-time",          majorHead: "Billing",     subHead: "One Time"   },
  { item: "annual",            majorHead: "Billing",     subHead: "One Time"   },
  { item: "deposit",           majorHead: "Billing",     subHead: "One Time"   },
  { item: "late fee",          majorHead: "Billing",     subHead: "One Time"   },
  { item: "nsf",               majorHead: "Billing",     subHead: "One Time"   },
  { item: "field trip",        majorHead: "Billing",     subHead: "One Time"   },
  { item: "summer",            majorHead: "Billing",     subHead: "One Time"   },
  { item: "t-shirt",           majorHead: "Billing",     subHead: "One Time"   },
  { item: "uniform",           majorHead: "Billing",     subHead: "One Time"   },
  { item: "photo",             majorHead: "Billing",     subHead: "One Time"   },

  // ── Billing: Regular ──────────────────────────────────────────────────────
  { item: "regular tuition",   majorHead: "Billing",     subHead: "Regular"    },
  { item: "tuition",           majorHead: "Billing",     subHead: "Regular"    },
  { item: "program fee",       majorHead: "Billing",     subHead: "Regular"    },
  { item: "monthly fee",       majorHead: "Billing",     subHead: "Regular"    },
  { item: "weekly fee",        majorHead: "Billing",     subHead: "Regular"    },
  { item: "full time",         majorHead: "Billing",     subHead: "Regular"    },
  { item: "part time",         majorHead: "Billing",     subHead: "Regular"    },
  { item: "infant",            majorHead: "Billing",     subHead: "Regular"    },
  { item: "toddler",           majorHead: "Billing",     subHead: "Regular"    },
  { item: "twaddler",          majorHead: "Billing",     subHead: "Regular"    },
  { item: "preschool",         majorHead: "Billing",     subHead: "Regular"    },
  { item: "pre-k",             majorHead: "Billing",     subHead: "Regular"    },
  { item: "prek",              majorHead: "Billing",     subHead: "Regular"    },
  { item: "kindergarten",      majorHead: "Billing",     subHead: "Regular"    },
  { item: "school age",        majorHead: "Billing",     subHead: "Regular"    },
];

async function main() {
  console.log("Seeding ItemMaster...");

  // Clear existing and re-seed
  await prisma.itemMaster.deleteMany({});

  const result = await prisma.itemMaster.createMany({
    data: items.map((i) => ({ ...i, isActive: true })),
    skipDuplicates: true,
  });

  console.log(`✓ Inserted ${result.count} item master records`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
