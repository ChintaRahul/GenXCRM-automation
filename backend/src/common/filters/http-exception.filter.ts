import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Response } from 'express';
import axios from 'axios';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const message = exception instanceof HttpException ? exception.getResponse() : 'Internal server error';

    if (status === HttpStatus.INTERNAL_SERVER_ERROR) {
      // An AxiosError's .stack never includes the upstream API's actual error body (Meta/Facebook/
      // etc.) — without logging it separately, every third-party integration failure is reduced to
      // "Request failed with status code NNN" and is undiagnosable from PM2 logs alone.
      if (axios.isAxiosError(exception)) {
        this.logger.error(`${exception.stack}\nUpstream response: ${JSON.stringify(exception.response?.data)}`);
      } else {
        this.logger.error(exception instanceof Error ? exception.stack : exception);
      }
    }

    if (response.headersSent) return;

    response.status(status).json({ statusCode: status, message, timestamp: new Date().toISOString() });
  }
}
