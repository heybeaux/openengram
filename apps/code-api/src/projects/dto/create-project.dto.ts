import { IsString, IsArray, IsNotEmpty, ArrayNotEmpty, MaxLength, Matches } from 'class-validator';

export class CreateProjectDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  @Matches(/^\/[a-zA-Z0-9_\-\/\.]+$/, {
    message: 'rootPath must be an absolute path with valid characters (no .. traversal)',
  })
  rootPath: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  languages: string[];
}
