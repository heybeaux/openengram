import { IsEnum, IsOptional, IsString } from 'class-validator';

export enum InsightFeedbackAction {
  DISMISSED = 'dismissed',
  ACTED_ON = 'acted_on',
  HELPFUL = 'helpful',
}

export class InsightFeedbackDto {
  @IsEnum(InsightFeedbackAction)
  action: InsightFeedbackAction;

  @IsOptional()
  @IsString()
  comment?: string;
}
