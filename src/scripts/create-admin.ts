import readline from "readline";
import { Writable } from "stream";
import { connectDB, disconnectDB } from "../config/db.js";
import { User } from "../models/user.model.js";
import { authService } from "../services/auth.service.js";
import { normalizeEmail } from "../utils/normalization.js";

/**
 * Prompts for plaintext input via terminal.
 */
const prompt = (query: string): Promise<string> => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
};

/**
 * Prompts for masked password input via terminal (outputs * instead of plaintext).
 */
const promptHidden = (query: string): Promise<string> => {
  return new Promise((resolve) => {
    let muted = false;
    const mutableStdout = new Writable({
      write(chunk, encoding, callback) {
        if (!muted) {
          process.stdout.write(chunk, encoding);
        } else {
          const str = chunk.toString();
          if (str !== "\r\n" && str !== "\n") {
            process.stdout.write("*");
          }
        }
        callback();
      },
    });

    const rl = readline.createInterface({
      input: process.stdin,
      output: mutableStdout,
      terminal: true,
    });

    rl.question(query, (password) => {
      rl.close();
      console.log(""); // newline
      resolve(password.trim());
    });

    muted = true;
  });
};

async function main() {
  console.log("======================================================");
  console.log("Neuways CRM - Secure Initial ADMIN Creation CLI");
  console.log("======================================================\n");

  try {
    await connectDB();

    // 1. Prompt Name (or read from ADMIN_NAME env)
    const name = (process.env.ADMIN_NAME || await prompt("Enter Admin Full Name: ")).trim();
    if (!name) {
      console.error("[Error] Admin name cannot be empty.");
      await disconnectDB();
      process.exit(1);
    }

    // 2. Prompt Email (or read from ADMIN_EMAIL env)
    const rawEmail = process.env.ADMIN_EMAIL || await prompt("Enter Admin Email: ");
    const email = normalizeEmail(rawEmail);
    if (!email || !email.includes("@")) {
      console.error("[Error] A valid email address is required.");
      await disconnectDB();
      process.exit(1);
    }

    // Check if user already exists
    const existing = await User.findOne({ email });
    if (existing) {
      console.error(`[Error] A user with email "${email}" already exists.`);
      await disconnectDB();
      process.exit(1);
    }

    // 3. Prompt Password (Hidden, or read from ADMIN_PASSWORD env)
    const password = process.env.ADMIN_PASSWORD || await promptHidden(
      "Enter Admin Password (min 8 characters): ",
    );
    if (password.length < 8) {
      console.error("[Error] Password must be at least 8 characters long.");
      await disconnectDB();
      process.exit(1);
    }

    // 4. Confirm Password (Hidden, or auto-match if provided via env)
    const confirmPassword = process.env.ADMIN_PASSWORD || await promptHidden("Confirm Admin Password: ");
    if (password !== confirmPassword) {
      console.error("[Error] Passwords do not match.");
      await disconnectDB();
      process.exit(1);
    }

    // 5. Hash Password & Persist Admin User
    const passwordHash = await authService.hashPassword(password);

    const admin = new User({
      name,
      email,
      passwordHash,
      role: "ADMIN",
      isActive: true,
      mustChangePassword: false,
    });

    await admin.save();

    console.log("\n======================================================");
    console.log(`[Success] ADMIN account created successfully for: ${email}`);
    console.log("Credentials are not logged or stored in source control.");
    console.log("======================================================\n");

    await disconnectDB();
    process.exit(0);
  } catch (err: unknown) {
    console.error(
      "[Error] Failed to create admin user:",
      (err as Error)?.message,
    );
    await disconnectDB();
    process.exit(1);
  }
}

main();
