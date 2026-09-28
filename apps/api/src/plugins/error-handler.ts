import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

// fastify-type-provider-zod's validatorCompiler throws the raw ZodError from
// schema.parse() on request validation failure (confirmed by reading its
// source: validatorCompiler returns {error} where error is whatever parse()
// threw). Its serializerCompiler throws a *different* ResponseValidationError
// when a handler's own return value doesn't match the declared response
// schema -- that's a bug in our code, not bad user input, so it must not be
// reported back to the client as if it were a 400.
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      reply.status(400).send({
        error: 'ValidationError',
        issues: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      });
      return;
    }

    request.log.error(error);

    const statusCode =
      typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 600
        ? error.statusCode
        : 500;

    // Never echo internal error details (stack traces, file paths) for a
    // genuine server error -- only pass through the message for well-formed
    // 4xx errors we raised ourselves.
    reply.status(statusCode).send({
      error: statusCode === 500 ? 'InternalServerError' : error.name,
      message: statusCode === 500 ? 'Something went wrong.' : error.message,
    });
  });
}
