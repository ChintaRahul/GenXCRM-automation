import { Module } from '@nestjs/common';
import { WhatsappTemplatesApi } from './whatsapp-templates.api';

// Wraps Meta's WhatsApp message-template management API. Exported for the templates module.
@Module({
  providers: [WhatsappTemplatesApi],
  exports: [WhatsappTemplatesApi],
})
export class WhatsappModule {}
