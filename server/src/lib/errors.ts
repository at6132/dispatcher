import type { FastifyReply, FastifyRequest } from 'fastify';

import { maskPhone, shortId } from './log.js';
import { notifyTelegram, shouldTelegramAlert } from './telegram.js';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function sendError(
  reply: FastifyReply,
  statusCode: number,
  message: string,
  code?: string,
) {
  const req = reply.request;
  const eventCode = code ?? 'error';
  if (req?.log) {
    const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
    req.log[level](
      {
        event: 'http.error',
        statusCode,
        code: eventCode,
        message,
        requestId: req.id,
        userId: shortId(req.user?.id),
        phone: maskPhone(req.user?.phone),
        path: (req.url ?? '').split('?')[0],
        method: req.method,
      },
      `http.error ${eventCode}`,
    );
  }

  if (req && shouldTelegramAlert({ statusCode, code: eventCode }) && !req._telegramAlerted) {
    req._telegramAlerted = true;
    notifyTelegram({
      title: 'API error',
      statusCode,
      code: eventCode,
      requestId: req.id,
      path: (req.url ?? '').split('?')[0],
      method: req.method,
      userId: shortId(req.user?.id),
      error: message,
    });
  }

  return reply.status(statusCode).send({
    error: {
      message,
      code: eventCode,
      requestId: req?.id,
    },
  });
}

export async function readJsonBody<T>(
  request: FastifyRequest,
): Promise<T> {
  return request.body as T;
}
