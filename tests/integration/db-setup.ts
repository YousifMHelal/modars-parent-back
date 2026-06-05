import { execSync } from "child_process";

export function setup(): void {
  execSync("npx prisma migrate deploy", {
    env: { ...process.env },
    stdio: "inherit",
  });
}
