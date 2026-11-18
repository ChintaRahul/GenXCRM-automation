import { Controller, Post, Get, Patch, Body, Param, Query, Headers, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PaymentGateway, PaymentStatus } from '@prisma/client';
import type { AuthUser } from '../../common/types/auth-user.type';

@Controller('payments')
export class PaymentsController {
  constructor(private payments: PaymentsService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  create(
    @Body()
    dto: {
      leadId: string;
      amount: number;
      currency?: string;
      gateway: PaymentGateway;
      discountAmount?: number;
      gstPercent?: number;
      includeGstNumber?: boolean;
      dueDate?: string;
      installments?: { amount: number; dueDate: string }[];
    },
    @CurrentUser() caller: AuthUser,
  ) {
    return this.payments.createPayment(dto, caller);
  }

  @UseGuards(JwtAuthGuard)
  @Get('dashboard')
  dashboard(@CurrentUser() caller: AuthUser) {
    return this.payments.getDashboard(caller);
  }

  @UseGuards(JwtAuthGuard)
  @Get('revenue/monthly')
  revenueMonthly(@Query('months') months: string, @CurrentUser() caller: AuthUser) {
    const parsed = parseInt(months, 10);
    return this.payments.getRevenueMonthly(Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 24) : 6, caller);
  }

  @UseGuards(JwtAuthGuard)
  @Get('upcoming-installments')
  upcomingInstallments(@Query('days') days: string, @CurrentUser() caller: AuthUser) {
    const parsed = parseInt(days, 10);
    return this.payments.getUpcomingInstallments(Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 90) : 14, caller);
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  list(
    @Query('status') status: PaymentStatus | undefined,
    @Query('sortBy') sortBy: string | undefined,
    @Query('sortOrder') sortOrder: 'asc' | 'desc' | undefined,
    @Query('page') page: string | undefined,
    @Query('limit') limit: string | undefined,
    @CurrentUser() caller: AuthUser,
  ) {
    return this.payments.list(
      {
        status,
        sortBy,
        sortOrder,
        page: page ? parseInt(page, 10) : undefined,
        limit: limit ? parseInt(limit, 10) : undefined,
      },
      caller,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('lead/:leadId')
  getByLead(@Param('leadId') leadId: string, @CurrentUser() caller: AuthUser) {
    return this.payments.getByLead(leadId, caller);
  }

  // Registered after every literal-segment GET above (dashboard, revenue/monthly,
  // upcoming-installments, lead/:leadId) — a bare :id wildcard declared earlier would
  // swallow those literal paths as an id value.
  @UseGuards(JwtAuthGuard)
  @Get(':id')
  getById(@Param('id') id: string, @CurrentUser() caller: AuthUser) {
    return this.payments.getById(id, caller);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/mark-paid')
  markPaid(
    @Param('id') id: string,
    @Body('gatewayPaymentId') gatewayPaymentId: string,
    @CurrentUser() caller: AuthUser,
  ) {
    return this.payments.markPaid(id, gatewayPaymentId, caller);
  }

  // Webhook — no JWT guard; verified by the Razorpay HMAC signature in the service.
  @Post('webhook/:gateway')
  webhook(
    @Param('gateway') gateway: PaymentGateway,
    @Headers('x-razorpay-signature') razorpaySignature: string,
    @Headers('x-webhook-signature') cashfreeSignature: string,
    @Headers('x-webhook-timestamp') cashfreeTimestamp: string,
    @Body() payload: Record<string, unknown>,
    @Req() req: Request,
  ) {
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(payload));
    const signature = gateway === PaymentGateway.CASHFREE ? cashfreeSignature : razorpaySignature;
    return this.payments.handleWebhook(gateway, rawBody, signature ?? '', payload, cashfreeTimestamp ?? '');
  }
}
