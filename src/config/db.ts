import mongoose, { ClientSession } from "mongoose";
import dns from "node:dns";
import { env } from "./env.js";

// Prefer IPv4 for faster address resolution on dual-stack hosts (prevents IPv6 timeouts on Windows)
if (typeof (dns as any).setDefaultResultOrder === "function") {
  (dns as any).setDefaultResultOrder("ipv4first");
}

interface DnsCacheEntry {
  address: string;
  family: number;
  timestamp: number;
}

const dnsCache = new Map<string, DnsCacheEntry>();
const DNS_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes cache to withstand transient DNS outages

const fallbackResolver = new dns.Resolver();
try {
  fallbackResolver.setServers(["8.8.8.8", "1.1.1.1"]);
} catch {
  // If setServers fails in a restricted environment, fallbackResolver uses default settings
}

/**
 * Resilient DNS lookup implementation for MongoDB Atlas cluster connections.
 * 1. Executes primary lookup via local system DNS.
 * 2. On transient failure (ENOTFOUND, ETIMEOUT), falls back to high-reliability public resolvers (8.8.8.8, 1.1.1.1).
 * 3. Caches resolved IP addresses in-memory to survive intermittent local DNS outages without dropping connections.
 */
export const resilientLookup = (
  hostname: string,
  options: any,
  callback: (
    err: NodeJS.ErrnoException | null,
    address: string | any[],
    family?: number,
  ) => void,
): void => {
  let cb = callback;
  let opts = options;
  if (typeof options === "function") {
    cb = options;
    opts = {};
  }

  // 1. Primary: Standard OS dns.lookup
  dns.lookup(hostname, opts, (err, address, family) => {
    if (!err && address) {
      const addrStr =
        typeof address === "string" ? address : (address as any)[0]?.address;
      const famNum =
        typeof family === "number" ? family : (address as any)[0]?.family || 4;
      if (addrStr) {
        dnsCache.set(hostname, {
          address: addrStr,
          family: famNum,
          timestamp: Date.now(),
        });
      }
      return cb(null, address, family);
    }

    // 2. Secondary: Check cache if recent
    const cached = dnsCache.get(hostname);
    if (cached && Date.now() - cached.timestamp < DNS_CACHE_TTL_MS) {
      if (typeof opts === "object" && opts?.all) {
        return cb(
          null,
          [{ address: cached.address, family: cached.family }] as any,
          cached.family,
        );
      }
      return cb(null, cached.address, cached.family);
    }

    // 3. Fallback: High-availability public DNS resolvers (Google 8.8.8.8, Cloudflare 1.1.1.1)
    fallbackResolver.resolve4(hostname, (fallbackErr, addresses) => {
      if (!fallbackErr && addresses && addresses.length > 0) {
        const selectedIp = addresses[0];
        dnsCache.set(hostname, {
          address: selectedIp,
          family: 4,
          timestamp: Date.now(),
        });
        if (typeof opts === "object" && opts?.all) {
          return cb(
            null,
            addresses.map((ip) => ({ address: ip, family: 4 })) as any,
            4,
          );
        }
        return cb(null, selectedIp, 4);
      }

      // 4. Stale cache fallback if all active resolutions failed
      if (cached) {
        console.warn(
          `[Neuways CRM] DNS resolution failed for "${hostname}"; using cached IP ${cached.address}`,
        );
        if (typeof opts === "object" && opts?.all) {
          return cb(
            null,
            [{ address: cached.address, family: cached.family }] as any,
            cached.family,
          );
        }
        return cb(null, cached.address, cached.family);
      }

      // Return original error if resolution is impossible
      return cb(err || fallbackErr, address, family);
    });
  });
};

/**
 * Identifies whether an error was caused by a transient database, connection, or network failure.
 */
export const isDatabaseError = (err: unknown): boolean => {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : "";
  return (
    name.includes("Mongo") ||
    name.includes("Mongoose") ||
    msg.includes("buffering timed out") ||
    msg.includes("ECONNREFUSED") ||
    msg.includes("ENOTFOUND") ||
    msg.includes("ETIMEDOUT") ||
    msg.includes("Server selection timed out") ||
    msg.includes("topology was destroyed") ||
    msg.includes("connection closed") ||
    msg.includes("not connected") ||
    mongoose.connection.readyState !== 1
  );
};

/**
 * Checks whether the current active Mongoose connection supports replica-set or sharded multi-document transactions.
 * Returns false when disconnected, using in-memory mocks, or running against standalone MongoDB (topology: 'Single').
 */
export const supportsTransactions = (): boolean => {
  if (mongoose.connection.readyState !== 1) {
    return false;
  }
  try {
    const conn = mongoose.connection as any;
    const client =
      conn.client ||
      (typeof conn.getClient === "function" ? conn.getClient() : null);
    if (!client || !client.topology) {
      return false;
    }
    const topologyType = client.topology.description?.type;
    return (
      topologyType === "ReplicaSetWithPrimary" || topologyType === "Sharded"
    );
  } catch {
    return false;
  }
};

/**
 * Reusable transaction helper.
 * Executes work inside a MongoDB session transaction when the connected topology supports it.
 * Invariants:
 * 1. If topology does not support transactions (or disconnected/mock), executes work(null).
 * 2. If topology supports transactions, creates a session and runs session.withTransaction().
 * 3. Never silently falls back to non-transactional writes if a transaction has started and failed.
 * 4. Ensures every created session is terminated in finally (session.endSession()).
 * 5. Does not leak credentials or connection strings.
 */
export async function withOptionalTransaction<T>(
  work: (session: ClientSession | null) => Promise<T>,
): Promise<T> {
  if (!supportsTransactions()) {
    return work(null);
  }

  const session = await mongoose.startSession();
  try {
    let result: T;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result!;
  } finally {
    await session.endSession();
  }
}

/**
 * Sanitizes MongoDB connection URI for safe console logging (masks credentials).
 */
export const sanitizeMongoUri = (uri: string): string => {
  try {
    return uri.replace(/\/\/(.*):(.*)@/, "//***:***@");
  } catch {
    return "mongodb+srv://***:***@masked";
  }
};

/**
 * Sanitizes an error message or object to prevent leaking connection strings or credentials in logs.
 */
export const sanitizeErrorMessage = (err: unknown): string => {
  const message = err instanceof Error ? err.message : String(err);
  return message.replace(/\/\/(.*):(.*)@/g, "//***:***@");
};

let listenersRegistered = false;
let activeConnectionPromise: Promise<void> | null = null;

/**
 * Connects to MongoDB Atlas using Mongoose with resilient connection pooling,
 * public DNS fallback, and bounded startup retries.
 */
export const connectDB = async (maxRetries = 3): Promise<void> => {
  if (mongoose.connection.readyState === 1) {
    return;
  }

  if (mongoose.connection.readyState === 2 && activeConnectionPromise) {
    return activeConnectionPromise;
  }

  if (!listenersRegistered) {
    mongoose.connection.on("connected", () => {
      console.log(
        "[Neuways CRM] MongoDB Atlas connection established successfully.",
      );
    });

    mongoose.connection.on("error", (err) => {
      console.error(
        "[Neuways CRM] MongoDB runtime connection error:",
        sanitizeErrorMessage(err),
      );
    });

    mongoose.connection.on("disconnected", () => {
      console.warn(
        "[Neuways CRM] MongoDB disconnected. Reconnection will be attempted automatically.",
      );
    });

    mongoose.connection.on("reconnected", () => {
      console.log(
        "[Neuways CRM] MongoDB Atlas connection re-established successfully.",
      );
    });

    listenersRegistered = true;
  }

  const sanitizedUri = sanitizeMongoUri(env.MONGODB_URI);
  console.log(
    `[Neuways CRM] Attempting database connection to: ${sanitizedUri}`,
  );

  activeConnectionPromise = (async () => {
    let attempt = 0;
    let lastError: unknown;

    while (attempt < maxRetries) {
      attempt++;
      try {
        await mongoose.connect(env.MONGODB_URI, {
          autoIndex: true,
          serverSelectionTimeoutMS: 15000, // 15-second timeout allows replica sets to elect primary
          connectTimeoutMS: 15000,
          socketTimeoutMS: 45000,
          maxPoolSize: 50,
          minPoolSize: 2,
          maxIdleTimeMS: 60000,
          retryWrites: true,
          retryReads: true,
          lookup: resilientLookup,
        });
        return;
      } catch (error) {
        lastError = error;
        console.error(
          `[Neuways CRM] Database connection attempt ${attempt}/${maxRetries} failed:`,
          sanitizeErrorMessage(error),
        );
        if (attempt < maxRetries) {
          const backoffMs = attempt * 1500;
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
        }
      }
    }

    throw lastError;
  })();

  try {
    await activeConnectionPromise;
  } finally {
    activeConnectionPromise = null;
  }
};

/**
 * Disconnects from MongoDB Atlas cleanly.
 */
export const disconnectDB = async (): Promise<void> => {
  try {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
      console.log("[Neuways CRM] MongoDB connection closed.");
    }
  } catch (error) {
    console.error(
      "[Neuways CRM] Error disconnecting from MongoDB:",
      sanitizeErrorMessage(error),
    );
  }
};
