import prisma from "../src/db/prisma.js";

export async function teardown() {
  await prisma.$disconnect();
}
