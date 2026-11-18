import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { InvoicesService } from './invoices.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/types/auth-user.type';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { UpdateInvoiceStatusDto } from './dto/update-invoice-status.dto';
import { GenerateFromRegistrationDto } from './dto/generate-from-registration.dto';
import {
  RecordRegistrationPaymentDto,
  RegistrationScreenshotUploadDto,
  SendRegistrationPaymentLinkDto,
} from './dto/registration-payment.dto';
import { CreateEmiMandateDto, CreateEmiPlanDto, RemindInstallmentDto } from './dto/emi.dto';
import { SendInvoiceDto } from './dto/send-invoice.dto';

@Controller('invoices')
export class InvoicesController {
  constructor(private invoices: InvoicesService) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  list(
    @Query('status') status: string | undefined,
    @Query('page') page: string | undefined,
    @Query('limit') limit: string | undefined,
    @Query('registered') registered: string | undefined,
    @CurrentUser() caller: AuthUser,
  ) {
    return this.invoices.list(
      {
        status,
        page: page ? parseInt(page, 10) : undefined,
        limit: limit ? parseInt(limit, 10) : undefined,
        registered: registered === 'true',
      },
      caller,
    );
  }

  // Registered before GET /invoices/:id — a literal path segment must be
  // declared before a :id wildcard that would otherwise swallow it.
  @UseGuards(JwtAuthGuard)
  @Get('next-number')
  getNextNumber(@CurrentUser() caller: AuthUser) {
    return this.invoices.getNextNumber(caller);
  }

  // "Register now, invoice later" step 1. Registered before GET /invoices/:id — a literal
  // path segment must be declared before a :id wildcard that would otherwise swallow it.
  @UseGuards(JwtAuthGuard)
  @Post('generate-from-registration')
  generateFromRegistration(@Body() dto: GenerateFromRegistrationDto, @CurrentUser() caller: AuthUser) {
    return this.invoices.generateFromRegistration(dto, caller);
  }

  // Literal second-segment path ("registration-screenshot") — distinct from the
  // :id/registration-payment... routes below, so no ambiguity with the :id wildcard.
  @UseGuards(JwtAuthGuard)
  @Post('registration-screenshot/presign')
  getRegistrationScreenshotUploadUrl(
    @Body() dto: RegistrationScreenshotUploadDto,
    @CurrentUser() caller: AuthUser,
  ) {
    return this.invoices.getRegistrationScreenshotUploadUrl(dto, caller);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  getById(@Param('id') id: string, @CurrentUser() caller: AuthUser) {
    return this.invoices.getById(id, caller);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/pdf')
  async getPdf(@Param('id') id: string, @CurrentUser() caller: AuthUser, @Res() res: Response) {
    const { buffer, filename } = await this.invoices.getInvoicePdf(id, caller);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    res.send(buffer);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  create(@Body() dto: CreateInvoiceDto, @CurrentUser() caller: AuthUser) {
    return this.invoices.create(dto, caller);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateInvoiceDto, @CurrentUser() caller: AuthUser) {
    return this.invoices.update(id, dto, caller);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateInvoiceStatusDto, @CurrentUser() caller: AuthUser) {
    return this.invoices.updateStatus(id, dto.status, caller);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() caller: AuthUser) {
    return this.invoices.remove(id, caller);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/send')
  send(@Param('id') id: string, @Body() dto: SendInvoiceDto, @CurrentUser() caller: AuthUser) {
    return this.invoices.send(id, dto, caller);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/registration-payment')
  recordRegistrationPayment(
    @Param('id') id: string,
    @Body() dto: RecordRegistrationPaymentDto,
    @CurrentUser() caller: AuthUser,
  ) {
    return this.invoices.recordRegistrationPayment(id, dto, caller);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/registration-payment/send-link')
  sendRegistrationPaymentLink(
    @Param('id') id: string,
    @Body() dto: SendRegistrationPaymentLinkDto,
    @CurrentUser() caller: AuthUser,
  ) {
    return this.invoices.sendRegistrationPaymentLink(id, dto, caller);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/registration-payment/mark-paid')
  markRegistrationFeePaid(@Param('id') id: string, @CurrentUser() caller: AuthUser) {
    return this.invoices.markRegistrationFeePaid(id, caller);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/registration-payment/screenshot-url')
  getRegistrationScreenshotDownloadUrl(@Param('id') id: string, @CurrentUser() caller: AuthUser) {
    return this.invoices.getRegistrationScreenshotDownloadUrl(id, caller);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/emi-plan')
  createEmiPlan(@Param('id') id: string, @Body() dto: CreateEmiPlanDto, @CurrentUser() caller: AuthUser) {
    return this.invoices.createEmiPlan(id, dto, caller);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/emi-mandate')
  createEmiMandate(@Param('id') id: string, @Body() dto: CreateEmiMandateDto, @CurrentUser() caller: AuthUser) {
    return this.invoices.createEmiMandate(id, dto, caller);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/emi-installments/:n/remind')
  remindInstallment(
    @Param('id') id: string,
    @Param('n') n: string,
    @Body() dto: RemindInstallmentDto,
    @CurrentUser() caller: AuthUser,
  ) {
    return this.invoices.remindInstallment(id, parseInt(n, 10), dto, caller);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/emi-installments/:n')
  markInstallmentPaid(@Param('id') id: string, @Param('n') n: string, @CurrentUser() caller: AuthUser) {
    return this.invoices.markInstallmentPaid(id, parseInt(n, 10), caller);
  }
}
