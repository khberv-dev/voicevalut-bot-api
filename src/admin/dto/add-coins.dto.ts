import {
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

export class AddCoinsDto {
  @IsInt()
  @IsPositive()
  amount: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;
}
