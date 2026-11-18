import { TradeIndiaSyncModule } from './modules/tradeindia-sync/tradeindia-sync.module';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bull';
import { PrismaModule } from './prisma/prisma.module';
import { ModulesFrameworkModule } from './modules-framework/modules-framework.module';
import { GuardsModule } from './common/guards/guards.module';
import { SessionTokenModule } from './auth/session-token.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { LeadsModule } from './modules/leads/leads.module';
import { LeadBackfillModule } from './modules/lead-backfill/lead-backfill.module';
import { AssignmentsModule } from './modules/assignments/assignments.module';
import { CommunicationsModule } from './modules/communications/communications.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { CoursesModule } from './modules/courses/courses.module';
import { TutorsModule } from './modules/tutors/tutors.module';
import { ReportsModule } from './modules/reports/reports.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { NurturingModule } from './modules/nurturing/nurturing.module';
import { GoogleFormsModule } from './modules/google-forms/google-forms.module';
import { TrialModule } from './modules/trial/trial.module';
import { ImportMappingsModule } from './modules/import-mappings/import-mappings.module';
import { TemplatesModule } from './modules/templates/templates.module';
import { IntegrationsConfigModule } from './modules/integrations-config/integrations-config.module';
import { BillingModule } from './modules/billing/billing.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { LeadStagesModule } from './modules/lead-stages/lead-stages.module';
import { PaymentReceiptsModule } from './modules/payment-receipts/payment-receipts.module';
import { InvoicesModule } from './modules/invoices/invoices.module';
import { CampaignsModule } from './modules/campaigns/campaigns.module';
import { FacebookInsightsModule } from './modules/facebook-insights/facebook-insights.module';
import { MfgActivitiesModule } from './modules/mfg-activities/mfg-activities.module';
import { ContactsModule } from './modules/contacts/contacts.module';
import { OpportunitiesModule } from './modules/opportunities/opportunities.module';
import { MfgLeadsModule } from './modules/mfg-leads/mfg-leads.module';
import { AccountsModule } from './modules/accounts/accounts.module';
import { RfqsModule } from './modules/rfqs/rfqs.module';
import { SiteVisitsModule } from './modules/site-visits/site-visits.module';
import { EvaluationsModule } from './modules/evaluations/evaluations.module';
import { ProductsModule } from './modules/products/products.module';
import { CostingSheetsModule } from './modules/costing-sheets/costing-sheets.module';
import { ApprovalsModule } from './modules/approvals/approvals.module';
import { QuotationsModule } from './modules/quotations/quotations.module';
import { PurchaseOrdersModule } from './modules/purchase-orders/purchase-orders.module';
import { DispatchModule } from './modules/dispatch/dispatch.module';
import { PaymentMilestonesModule } from './modules/payment-milestones/payment-milestones.module';
import { SalesOrdersModule } from './modules/sales-orders/sales-orders.module';
import { CoverageModule } from './modules/coverage/coverage.module';
import { ServiceTicketsModule } from './modules/service-tickets/service-tickets.module';
import { InstalledAssetsModule } from './modules/installed-assets/installed-assets.module';
import { MasterValuesModule } from './modules/master-values/master-values.module';
import { ApprovalRulesModule } from './modules/approval-rules/approval-rules.module';
import { SlaPoliciesModule } from './modules/sla-policies/sla-policies.module';
import { SlaTimersModule } from './modules/sla-timers/sla-timers.module';
import { BusinessCalendarsModule } from './modules/business-calendars/business-calendars.module';
import { HolidaysModule } from './modules/holidays/holidays.module';
import { AutomationRulesModule } from './modules/automation-rules/automation-rules.module';
import { RolePermissionsModule } from './modules/role-permissions/role-permissions.module';
import { FieldPermissionsModule } from './modules/field-permissions/field-permissions.module';
import { DocumentTemplatesModule } from './modules/document-templates/document-templates.module';
import { DealersModule } from './modules/dealers/dealers.module';
import { TendersModule } from './modules/tenders/tenders.module';
import { ErpSyncModule } from './modules/erp-sync/erp-sync.module';
import { MfgReportsModule } from './modules/mfg-reports/mfg-reports.module';
import { MfgDashboardModule } from './modules/mfg-dashboard/mfg-dashboard.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { FollowUpRemindersModule } from './modules/follow-up-reminders/follow-up-reminders.module';

@Module({
  imports: [
    // `.env.local` (gitignored) holds local-dev overrides and wins over the
    // prod-shaped `.env`; vars absent from `.env.local` fall back to `.env`.
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env.local', '.env'] }),
    BullModule.forRoot({
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: Number(process.env.REDIS_PORT) || 6379,
        // Isolates the E2E backend's BullMQ queues (see .env.e2e.local) onto a separate
        // Redis logical DB so it never races the regular dev backend for the same jobs
        // — two backends sharing DB 0 would each pick up assignment jobs meant for the
        // other's Postgres database and fail with "lead not found".
        db: Number(process.env.REDIS_DB) || 0,
      },
    }),
    PrismaModule,
    ModulesFrameworkModule,
    GuardsModule,
    SessionTokenModule,
    AuthModule,
    UsersModule,
    LeadsModule,
    LeadBackfillModule,
    AssignmentsModule,
    CommunicationsModule,
    PaymentsModule,
    CoursesModule,
    TutorsModule,
    ReportsModule,
    IntegrationsModule,
    NurturingModule,
    GoogleFormsModule,
    TrialModule,
    ImportMappingsModule,
    TemplatesModule,
    IntegrationsConfigModule,
    BillingModule,
    OrganizationsModule,
    PaymentReceiptsModule,
    InvoicesModule,
    CampaignsModule,
    FacebookInsightsModule,
    TradeIndiaSyncModule,
    MfgActivitiesModule,
    ContactsModule,
    OpportunitiesModule,
    MfgLeadsModule,
    AccountsModule,
    RfqsModule,
    SiteVisitsModule,
    EvaluationsModule,
    ProductsModule,
    CostingSheetsModule,
    ApprovalsModule,
    QuotationsModule,
    PurchaseOrdersModule,
    DispatchModule,
    PaymentMilestonesModule,
    SalesOrdersModule,
    CoverageModule,
    ServiceTicketsModule,
    InstalledAssetsModule,
    MasterValuesModule,
    ApprovalRulesModule,
    SlaPoliciesModule,
    SlaTimersModule,
    BusinessCalendarsModule,
    HolidaysModule,
    AutomationRulesModule,
    RolePermissionsModule,
    FieldPermissionsModule,
    DocumentTemplatesModule,
    DealersModule,
    TendersModule,
    ErpSyncModule,
    MfgReportsModule,
    MfgDashboardModule,
    NotificationsModule,
    FollowUpRemindersModule,
    LeadStagesModule,
  ],
})
export class AppModule {}
