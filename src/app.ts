import express, { Application, Request, Response, NextFunction } from "express";
import cors from "cors";
import mongoose from "mongoose";
import { env } from "./config/env.js";
import { authRouter } from "./routes/auth.routes.js";
import { enquiryRouter } from "./routes/enquiry.routes.js";
import { securityLogsRouter, alertsRouter } from "./routes/security.routes.js";
import { userRouter } from "./routes/user.routes.js";
import { notificationRouter } from "./routes/notification.routes.js";
import { propertyMappingRouter } from "./routes/property-mapping.routes.js";
import { bulkImportRouter } from "./routes/bulk-import.routes.js";

export const createApp = (): Application => {
  const app = express();

  // 1. CORS Middleware (Supports configured origins and all localhost/127.0.0.1 ports in development)
  const configuredOrigins = env.CLIENT_ORIGIN
    ? env.CLIENT_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean)
    : ['http://localhost:5173'];

  app.use(
    cors({
      origin: (requestOrigin, callback) => {
        // Allow requests with no origin (e.g. mobile apps, curl, server-to-server)
        if (!requestOrigin) {
          return callback(null, true);
        }

        // Allow explicitly configured origins
        if (configuredOrigins.includes(requestOrigin)) {
          return callback(null, true);
        }

        // In development, automatically allow any localhost / 127.0.0.1 port (e.g. 5173, 5174, 5175)
        if (env.NODE_ENV === 'development') {
          const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(requestOrigin);
          if (isLocalhost) {
            return callback(null, true);
          }
        }

        return callback(null, false);
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    }),
  );

  // 2. Controlled JSON Request Body Parser (Runs BEFORE all application routers)
  app.use(express.json({ limit: "50kb" }));

  // 3. Health-Check Endpoint (Reports actual database connectivity)
  app.get("/api/v1/health", (_req: Request, res: Response) => {
    const isDbConnected = mongoose.connection.readyState === 1;

    if (!isDbConnected) {
      return res.status(503).json({
        status: "degraded",
        app: "Neuways CRM",
        environment: env.NODE_ENV,
        database: "disconnected",
        timestamp: new Date().toISOString(),
      });
    }

    return res.status(200).json({
      status: "ok",
      app: "Neuways CRM",
      environment: env.NODE_ENV,
      database: "connected",
      timestamp: new Date().toISOString(),
    });
  });

  // 4. Application Routes
  // Public Authentication Routes (login)
  app.use("/api/v1/auth", authRouter);

  // Protected Enquiry Routes (requires valid employee token with ADMIN, MANAGER, or SALES role)
  app.use("/api/v1/enquiries", enquiryRouter);
  app.use("/api/v1/duplicates", enquiryRouter);

  // Protected Security Log Routes (ADMIN only)
  app.use("/api/v1/security-logs", securityLogsRouter);

  // Protected Alert Routes (ADMIN only)
  app.use("/api/v1/alerts", alertsRouter);

  // Protected User Provisioning & Management Routes (ADMIN only)
  app.use("/api/v1/users", userRouter);

  // Protected In-App Notification & Alert Routes (enforces recipient role-scoping)
  app.use("/api/v1/notifications", notificationRouter);

  // Protected Property-to-Agent Round Robin Mapping Routes (ADMIN management, ADMIN/MANAGER retrieval)
  app.use("/api/v1/properties", propertyMappingRouter);

  // Protected Bulk Data Upload Routes (ADMIN, MANAGER, SALES)
  app.use("/api/v1/bulk-import", bulkImportRouter);

  // 5. Centralized Error Handling Middleware (including HTTP 413 Payload Too Large)
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    const errorObj = err as {
      type?: string;
      status?: number;
      statusCode?: number;
    };

    if (
      errorObj &&
      (errorObj.type === "entity.too.large" ||
        errorObj.status === 413 ||
        errorObj.statusCode === 413)
    ) {
      return res.status(413).json({
        error: "Payload Too Large",
        message: "Request body exceeds the allowed 50kb limit.",
      });
    }

    if (err) {
      return res.status(errorObj?.status || errorObj?.statusCode || 500).json({
        error: "Internal Server Error",
        message: "An unexpected server error occurred.",
      });
    }

    return next();
  });

  return app;
};
