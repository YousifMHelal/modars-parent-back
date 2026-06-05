import { PrismaClient } from "@prisma/client";

declare global {
  var __prisma: PrismaClient | undefined;
}

const prisma: PrismaClient =
  globalThis.__prisma ??
  new PrismaClient({
    log: process.env["NODE_ENV"] === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env["NODE_ENV"] !== "production") {
  globalThis.__prisma = prisma;
}

export async function connect(): Promise<void> {
  await prisma.$connect();
}

export async function disconnect(): Promise<void> {
  await prisma.$disconnect();
}

export default prisma;
