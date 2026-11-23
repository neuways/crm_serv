import { createApp } from "./app.js";
import { connectDB, disconnectDB } from "./config/db.js";
import { env } from "./config/env.js";
import { enquiryService } from "./services/enquiry.service.js";
import { bulkImportService } from "./services/bulk-import.service.js";

const startServer = async () => {
  // Fail-Fast: Require successful database connection before starting HTTP listener
  try {
    await connectDB();
    // Non-blocking background initial follow-up task reconciliation for existing active leads
    enquiryService.ensureInitialTasksForActiveEnquiries().catch((initErr) => {
      console.warn('[Neuways CRM] Initial follow-up task reconciliation warning:', initErr);
    });
    // Non-blocking background recovery for any interrupted bulk imports after server restart
    bulkImportService.recoverInterruptedImports().catch((recErr) => {
      console.warn('[Neuways CRM] Bulk import recovery warning:', recErr);
    });
  } catch (_error) {
    console.error("\n======================================================");
    console.error("[Neuways CRM] Fatal Database Connection Failure");
    console.error("======================================================");
    console.error(
      "The server could not establish a connection to MongoDB Atlas.",
    );
    console.error("Action Required:");
    console.error(
      "1. Verify your network IP is whitelisted in MongoDB Atlas console.",
    );
    console.error(
      "2. Confirm your database user credentials and cluster address in server/.env.",
    );
    console.error(
      "3. Ensure outbound access on port 27017 is allowed by your firewall.\n",
    );
    process.exit(1);
  }

  const app = createApp();

  const server = app.listen(env.PORT, () => {
    console.log(
      `[Neuways CRM] Backend server running on http://localhost:${env.PORT}`,
    );
    console.log(
      `[Neuways CRM] Healthcheck available at http://localhost:${env.PORT}/api/v1/health`,
    );
  });

  const gracefulShutdown = async (signal: string) => {
    console.log(
      `\n[Neuways CRM] Received ${signal}. Shutting down gracefully...`,
    );
    server.close(async () => {
      await disconnectDB();
      console.log("[Neuways CRM] HTTP server closed.");
      process.exit(0);
    });
  };

  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
};

startServer();
