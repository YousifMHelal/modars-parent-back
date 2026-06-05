import { config as loadDotenv } from "dotenv";

loadDotenv({ path: ".env.test", override: false });

process.env["NODE_ENV"] ??= "test";
process.env["DATABASE_URL"] ??= "postgresql://modars:modarsdev@localhost:5432/modars_test";
process.env["REDIS_URL"] ??= "redis://localhost:6379";
process.env["CORS_ORIGINS"] ??= "http://localhost:5173";
process.env["PORT"] ??= "4001";
