import type { FastifyReply, FastifyRequest } from 'fastify';

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
  return reply.status(statusCode).send({
    error: {
      message,
      code: code ?? 'error',
    },
  });
}

export async function readJsonBody<T>(
  request: FastifyRequest,
): Promise<T> {
  return request.body as T;
}
