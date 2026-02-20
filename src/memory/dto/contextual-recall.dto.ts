import { IsString, IsOptional, IsArray, IsNumber } from 'class-validator';

export class DelegationContextDto {
  @IsString()
  delegatingAgentSessionKey: string;

  @IsOptional()
  @IsString()
  taskDescription?: string;

  @IsOptional()
  @IsNumber()
  boostFactor?: number; // default 1.5
}

export class ContextualRecallDto {
  @IsString()
  text: string;

  @IsString()
  sessionKey: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  excludeIds?: string[];

  @IsOptional()
  @IsNumber()
  maxResults?: number = 5;

  @IsOptional()
  @IsNumber()
  maxTokens?: number = 500;

  @IsOptional()
  @IsNumber()
  minScore?: number = 0.65;

  // v0.7: Agent session for pool-filtered recall
  @IsOptional()
  @IsString()
  agentSessionKey?: string;

  // HEY-189: Delegation context for boosting delegator's memories
  @IsOptional()
  delegationContext?: DelegationContextDto;
}

export class ContextualRecallResponseDto {
  memories: Array<{
    id: string;
    raw: string;
    layer: string;
    score: number;
    topics: string[];
  }>;
  topicShift: boolean;
  tokenCount: number;
  latencyMs: number;
}
