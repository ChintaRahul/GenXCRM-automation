import { Controller, Get, Post, Patch, Body, Headers, Req, UseGuards, Logger } from '@nestjs/common';
import { Request } from 'express';
import { Role } from '@prisma/client';
import { BillingService } from './billing.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/types/auth-user.type';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { ConfirmPaymentDto } from './dto/confirm-payment.dto';
import { PurchaseAddonDto } from './dto/purchase-addon.dto';
import { UpdateSeatsDto } from './dto/update-seats.dto';
import { ConfirmSeatUpdateDto } from './dto/confirm-seat-update.dto';
import { ValidateCouponDto } from './dto/validate-coupon.dto';

@Controller('billing')
export class BillingController {
  private readonly logger = new Logger(BillingController.name);

  constructor(private readonly billing: BillingService) {}

  // Public: the plan catalog is global (no orgId on SubscriptionPlan), and the
  // registration wizard needs it before an account/session exists.
  @Get('plans')
  getPlans() {
    return this.billing.getPlans();
  }

  // Public: validated during registration before any account/session exists.
  // Never trust a client-computed discount — this is the only source of truth
  // for a coupon's terms, and createSubscriptionForNewOrg() re-validates server-side.
  @Post('coupons/validate')
  validateCoupon(@Body() dto: ValidateCouponDto) {
    return this.billing.validateCoupon(dto.code, dto.planId);
  }

  @Post('subscribe')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DIRECTOR, Role.MANAGER)
  subscribe(@Body() dto: CreateSubscriptionDto, @CurrentUser() caller: AuthUser) {
    return this.billing.subscribe(dto, caller);
  }

  @Get('subscription')
  @UseGuards(JwtAuthGuard)
  getSubscription(@CurrentUser() caller: AuthUser) {
    return this.billing.getSubscription(caller);
  }

  @Get('active-users')
  @UseGuards(JwtAuthGuard)
  getActiveUserCount(@CurrentUser() caller: AuthUser) {
    return this.billing.getActiveUserCount(caller);
  }

  @Patch('subscription/seats')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DIRECTOR, Role.MANAGER)
  updateSeats(@Body() dto: UpdateSeatsDto, @CurrentUser() caller: AuthUser) {
    return this.billing.updateSeats(dto.userCount, caller);
  }

  @Post('subscription/seats/checkout')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DIRECTOR, Role.MANAGER)
  initiateSeatUpdate(@Body() dto: UpdateSeatsDto, @CurrentUser() caller: AuthUser) {
    return this.billing.initiateSeatUpdate(dto.userCount, caller);
  }

  @Post('subscription/seats/confirm')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DIRECTOR, Role.MANAGER)
  confirmSeatUpdate(@Body() dto: ConfirmSeatUpdateDto, @CurrentUser() caller: AuthUser) {
    return this.billing.confirmSeatUpdate(dto, caller);
  }

  @Post('subscription/confirm')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DIRECTOR, Role.MANAGER)
  confirmPayment(@Body() dto: ConfirmPaymentDto, @CurrentUser() caller: AuthUser) {
    return this.billing.confirmPayment(dto.razorpayPaymentId, dto.razorpaySubscriptionId, caller);
  }

  @Post('subscription/cancel')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DIRECTOR, Role.MANAGER)
  cancelSubscription(@CurrentUser() caller: AuthUser) {
    return this.billing.cancelSubscription(caller);
  }

  @Post('addon')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DIRECTOR, Role.MANAGER)
  purchaseAddon(@Body() dto: PurchaseAddonDto, @CurrentUser() caller: AuthUser) {
    return this.billing.purchaseAddon(dto, caller);
  }

  @Get('invoices')
  @UseGuards(JwtAuthGuard)
  getBillingHistory(@CurrentUser() caller: AuthUser) {
    return this.billing.getBillingHistory(caller);
  }

  // No JWT guard — verified by HMAC signature inside the service
  @Post('webhook')
  webhook(
    @Headers('x-razorpay-signature') signature: string,
    @Body() payload: Record<string, unknown>,
    @Req() req: Request,
  ) {
    const event = payload.event as string | undefined;
    const rawBodyBuf = (req as Request & { rawBody?: Buffer }).rawBody;
    this.logger.log(`Webhook received: event=${event ?? 'unknown'} sig=${signature ? 'present' : 'missing'} rawBody=${rawBodyBuf ? 'captured' : 'fallback'}`);

    const rawBody = rawBodyBuf ?? Buffer.from(JSON.stringify(payload));
    return this.billing.handleWebhook(rawBody, signature ?? '', payload);
  }
}
