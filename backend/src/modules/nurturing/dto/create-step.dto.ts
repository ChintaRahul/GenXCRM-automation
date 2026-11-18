import { IsArray, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

// SMS is temporarily disabled. Email steps use a body; WhatsApp steps reference an approved Meta
// template (templateName/templateLang/templateParams) — the dispatcher records the communication.
export const STEP_TYPES = ['email', 'whatsapp', 'wait'] as const;

export class CreateStepDto {
  @IsIn(STEP_TYPES)
  type: (typeof STEP_TYPES)[number];

  @IsInt()
  @Min(0)
  stepOrder: number;

  @IsOptional()
  @IsString()
  subject?: string;

  @IsOptional()
  @IsString()
  body?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  delayDays?: number;

  // WhatsApp steps only — an approved Meta template. templateName is the Meta template name;
  // templateParams is the ordered {{1}}..{{n}} list (each entry may contain {{name}}/{{course}}/…).
  @IsOptional()
  @IsString()
  templateName?: string;

  @IsOptional()
  @IsString()
  templateLang?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  templateParams?: string[];

  // Email steps only — ids of previously-uploaded Attachment rows, reused for every
  // enrollment that reaches this step.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  attachmentIds?: string[];
}
