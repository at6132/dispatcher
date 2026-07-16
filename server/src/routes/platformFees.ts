import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { AppError, sendError } from '../lib/errors.js';
import { trackEvent } from '../lib/analytics.js';
import { assertClientLimits, requireJsonContentType } from '../lib/security.js';
import { requireAuth, requireUser } from '../middleware/auth.js';
import { markPlatformFeePaid } from '../services/platformFees.js';

export const platformFeeRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);
  app.addHook('preHandler', async (request) => {
    requireJsonContentType(request);
  });

  app.post('/:id/mark-paid', async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return sendError(reply, 400, 'Invalid id', 'invalid_id');
    const body = z
      .object({
        settlementProofKey: z.string().min(1).max(500).optional(),
      })
      .safeParse(request.body ?? {});
    if (!body.success) {
      return sendError(reply, 400, 'Invalid body', 'invalid_body');
    }
    try {
      await assertClientLimits(request, reply, {
        name: 'platform_fee_mark_paid',
        ipLimit: 40,
        userLimit: 30,
        windowSec: 3600,
        failClosed: true,
      });
      const user = requireUser(request);
      const fee = await markPlatformFeePaid(
        user.id,
        params.data.id,
        body.data.settlementProofKey,
      );
      trackEvent({
        name: 'platform_fee.mark_paid',
        userId: user.id,
        requestId: request.id,
        ip: request.ip,
        props: {
          feeId: params.data.id,
          hasProof: Boolean(body.data.settlementProofKey),
        },
      });
      return reply.send({
        platformFee: {
          id: fee.id,
          status: fee.status,
          paidAt: fee.paidAt?.toISOString() ?? null,
          settledAt: fee.settledAt?.toISOString() ?? null,
        },
      });
    } catch (err) {
      if (err instanceof AppError) {
        return sendError(reply, err.statusCode, err.message, err.code);
      }
      throw err;
    }
  });
};
