import { connectDB, disconnectDB } from '../config/db.js';
import { env } from '../config/env.js';
import { User } from '../models/user.model.js';
import { authService } from '../services/auth.service.js';
import { normalizeEmail } from '../utils/normalization.js';

async function seedDemoSales() {
  // Production safety check: Refuse to run against production or Atlas
  if (env.NODE_ENV === 'production' || env.MONGODB_URI.includes('+srv') || env.MONGODB_URI.includes('mongodb.net')) {
    console.error('[Safety Block] Refusing to seed demo accounts against production Atlas configuration.');
    process.exit(1);
  }

  try {
    await connectDB();

    const demoAgents = [
      {
        name: 'Rahul Sharma',
        email: 'sales.rahul@neuways.local',
        password: process.env.DEMO_SALES_PASSWORD || 'Sales@123',
        role: 'SALES' as const
      },
      {
        name: 'Priya Patel',
        email: 'sales.priya@neuways.local',
        password: process.env.DEMO_SALES_PASSWORD || 'Sales@123',
        role: 'SALES' as const
      }
    ];

    for (const agent of demoAgents) {
      const normalized = normalizeEmail(agent.email);
      let user = await User.findOne({ email: normalized });

      if (user) {
        user.role = 'SALES';
        user.isActive = true;
        user.mustChangePassword = false;
        user.passwordHash = await authService.hashPassword(agent.password);
        await user.save();
        console.log(`[Demo Seed] Updated existing sales agent: ${normalized}`);
      } else {
        const passwordHash = await authService.hashPassword(agent.password);
        user = new User({
          name: agent.name,
          email: normalized,
          passwordHash,
          role: 'SALES',
          isActive: true,
          mustChangePassword: false
        });
        await user.save();
        console.log(`[Demo Seed] Created new demo sales agent: ${normalized}`);
      }
    }

    await disconnectDB();
    console.log('[Demo Seed] Completed successfully.');
    process.exit(0);
  } catch (err: any) {
    console.error('[Demo Seed Error]:', err.message);
    await disconnectDB();
    process.exit(1);
  }
}

seedDemoSales();
