import type { FastifyPluginAsync } from 'fastify';

import { adminAuthRoutes } from './auth.js';
import { adminOpsRoutes } from './ops.js';

export const adminRoutes: FastifyPluginAsync = async (app) => {
  await app.register(adminAuthRoutes, { prefix: '/auth' });
  await app.register(adminOpsRoutes);
};
