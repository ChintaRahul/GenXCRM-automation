import { Controller, Get, UseGuards } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/types/auth-user.type';

// Standalone controller rather than a home on IntegrationsConfigController: that module is
// scoped to lead-source integrations (Facebook/Google Ads), not payment gateways — this is a
// read-only status check the Invoices UI needs, so it lives alongside InvoicesService instead.
@Controller('integrations/payment-gateways')
export class PaymentGatewaysController {
  constructor(private invoices: InvoicesService) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  getConnectedPaymentGateways(@CurrentUser() caller: AuthUser) {
    return this.invoices.getConnectedPaymentGateways(caller);
  }
}
