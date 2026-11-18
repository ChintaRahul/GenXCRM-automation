import { PartialType } from '@nestjs/mapped-types';
import { CreateInstalledAssetDto } from './create-installed-asset.dto';

export class UpdateInstalledAssetDto extends PartialType(CreateInstalledAssetDto) {}
