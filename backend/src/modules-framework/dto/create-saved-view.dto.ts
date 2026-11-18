import { IsNotEmpty, IsObject, IsString, MaxLength } from 'class-validator';

export class CreateSavedViewDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  readonly name!: string;

  // The list's filter state, as the client built it. Stored opaquely and only ever replayed to
  // the same user, so the server does not interpret it — every real query still goes through
  // buildListFilters, which whitelists and scopes.
  @IsObject()
  readonly filters!: Record<string, unknown>;
}
