import dotenv from "dotenv";
import path from "node:path";
import fs from "node:fs";
import { z } from "zod";

// Robustly locate server/.env regardless of process.cwd() (workspace root vs server folder)
const baseDir = typeof __dirname !== "undefined" ? __dirname : process.cwd();
const candidateEnvPaths = [
  path.resolve(baseDir, "../../.env"), // from src/config or dist/config to server/.env
  path.resolve(process.cwd(), "server/.env"), // when run from workspace root
  path.resolve(process.cwd(), ".env"), // when run from server folder
];

let envLoaded = false;
for (const envPath of candidateEnvPaths) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    envLoaded = true;
    break;
  }
}

if (!envLoaded) {
  dotenv.config();
}

const PLACEHOLDER_REGEX = /<[^>]+>/;

const envSchema = z.object({
  PORT: z
    .string()
    .default("5000")
    .transform((val) => parseInt(val, 10)),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  CLIENT_ORIGIN: z.string().default("http://localhost:5173"),
  MONGODB_URI: z
    .string()
    .min(1, { message: "MONGODB_URI is required and cannot be empty" })
    .refine((val) => !PLACEHOLDER_REGEX.test(val), {
      message:
        "MONGODB_URI contains unreplaced template placeholders (e.g. <username>, <password>)",
    }),
  JWT_SECRET: z
    .string()
    .min(32, {
      message: "JWT_SECRET is required and must be at least 32 characters long",
    }),
  ACTIVE_ENQUIRY_STATUSES: z
    .string()
    .default("ACTIVE")
    .transform((val) =>
      val
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean),
    ),
  GOOGLE_CLIENT_ID: z.string().optional(),
});

const parseEnv = () => {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error("\n======================================================");
    console.error("[Neuways CRM] Fatal Configuration Error");
    console.error("======================================================");
    for (const [key, issues] of Object.entries(result.error.format())) {
      if (
        key !== "_errors" &&
        issues &&
        "_errors" in issues &&
        Array.isArray(issues._errors)
      ) {
        console.error(`- ${key}: ${issues._errors.join(", ")}`);
      }
    }
    console.error("\nAction Required:");
    console.error(
      "1. Ensure server/.env exists (copy from server/.env.example).",
    );
    console.error(
      "2. Provide a valid MongoDB Atlas connection string for MONGODB_URI.",
    );
    console.error("3. Provide a secure JWT_SECRET of at least 32 characters.");
    console.error(
      "4. Replace all placeholder tokens like <username> and <password>.\n",
    );
    process.exit(1);
  }
  return result.data;
};

export const env = parseEnv();
