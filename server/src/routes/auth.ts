import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { AppError, sendError } from '../lib/errors.js';
import { normalizePhone } from '../lib/phone.js';
import { rateLimit } from '../lib/redis.js';
import * as auth from '../services/auth.js';

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post('/signup', async (request, reply) => {
    const body = z
      .object({
        name: z.string(),
        phone: z.string(),
        password: z.string(),
      })
      .safeParse(request.body);
    if (!body.success) {
      return sendError(reply, 400, 'Invalid body', 'invalid_body');
    }

    const ip = request.ip;
    const phoneKey = normalizePhone(body.data.phone) || 'invalid';
    const waits = await Promise.all([
      rateLimit({ key: `signup:ip:${ip}`, limit: 20, windowSec: 600 }),
      rateLimit({ key: `signup:phone:${phoneKey}`, limit: 5, windowSec: 600 }),
    ]);
    const wait = waits.find((w) => w != null) ?? null;
    if (wait) {
      reply.header('Retry-After', Math.ceil(wait / 1000));
      return sendError(reply, 429, 'Too many attempts', 'rate_limited');
    }

    try {
      const tokens = await auth.signup(body.data);
      return reply.status(201).send(tokens);
    } catch (err) {
      if (err instanceof AppError) {
        return sendError(reply, err.statusCode, err.message, err.code);
      }
      throw err;
    }
  });

  app.post('/login', async (request, reply) => {
    const body = z
      .object({
        phone: z.string(),
        password: z.string(),
      })
      .safeParse(request.body);
    if (!body.success) {
      return sendError(reply, 400, 'Invalid body', 'invalid_body');
    }

    const phoneKey = normalizePhone(body.data.phone) || 'invalid';
    const waits = await Promise.all([
      rateLimit({ key: `login:ip:${request.ip}`, limit: 60, windowSec: 600 }),
      rateLimit({ key: `login:phone:${phoneKey}`, limit: 20, windowSec: 600 }),
    ]);
    const wait = waits.find((w) => w != null) ?? null;
    if (wait) {
      reply.header('Retry-After', Math.ceil(wait / 1000));
      return sendError(reply, 429, 'Too many attempts', 'rate_limited');
    }

    try {
      const tokens = await auth.login(body.data);
      return reply.send(tokens);
    } catch (err) {
      if (err instanceof AppError) {
        // Uniform login failure for wrong password; lock still disclosed by product need
        if (err.code === 'invalid_credentials') {
          return sendError(reply, 401, 'Invalid phone or password.', 'invalid_credentials');
        }
        return sendError(reply, err.statusCode, err.message, err.code);
      }
      throw err;
    }
  });

  app.post('/refresh', async (request, reply) => {
    const body = z
      .object({ refreshToken: z.string().min(1) })
      .safeParse(request.body);
    if (!body.success) {
      return sendError(reply, 400, 'Invalid body', 'invalid_body');
    }

    const wait = await rateLimit({
      key: `refresh:ip:${request.ip}`,
      limit: 120,
      windowSec: 600,
    });
    if (wait) {
      reply.header('Retry-After', Math.ceil(wait / 1000));
      return sendError(reply, 429, 'Too many attempts', 'rate_limited');
    }

    try {
      const tokens = await auth.refresh(body.data.refreshToken);
      return reply.send(tokens);
    } catch (err) {
      if (err instanceof AppError) {
        return sendError(reply, err.statusCode, err.message, err.code);
      }
      throw err;
    }
  });

  app.post('/logout', async (request, reply) => {
    const body = z
      .object({ refreshToken: z.string().optional() })
      .safeParse(request.body ?? {});
    await auth.logout(body.success ? body.data.refreshToken : undefined);
    return reply.status(204).send();
  });
};
