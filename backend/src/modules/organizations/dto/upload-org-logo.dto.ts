import { IsIn } from 'class-validator';

// PNG/JPEG only — pdfkit's doc.image() (used to embed the logo on invoice PDFs) can't
// decode SVG or WebP.
const ALLOWED_LOGO_TYPES = ['image/png', 'image/jpeg'] as const;

export class UploadOrgLogoDto {
  @IsIn(ALLOWED_LOGO_TYPES)
  contentType: (typeof ALLOWED_LOGO_TYPES)[number];
}
