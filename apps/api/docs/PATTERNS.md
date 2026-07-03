# NestJS Patterns

## Module Structure
Every domain gets its own NestJS module:
```typescript
@Module({
  imports: [PrismaModule, ConfigModule],
  controllers: [MyController],
  providers: [MyService],
  exports: [MyService],  // Export if other modules need it
})
export class MyModule {}
```

## DTOs with class-validator
**Every field must have decorators.** `ValidationPipe` runs with `whitelist: true`, which silently strips any field without a decorator.

```typescript
export class CreateMemoryDto {
  @IsString()
  raw: string;

  @IsOptional()
  @IsEnum(MemoryLayer)
  layer?: MemoryLayer;

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @Transform(({ value }) => mapValue(value))  // Transform before validation
  @IsEnum(ImportanceHint)
  importance?: ImportanceHint;
}
```

**Common mistake**: Adding a field to the DTO class without a decorator → it gets stripped and you get `undefined` in your service.

## Guards
```typescript
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    // Localhost bypasses auth
    // Otherwise, validate API key from Authorization header
  }
}
```

Applied globally or per-controller with `@UseGuards(ApiKeyGuard)`.

## Service Injection
```typescript
@Injectable()
export class MemoryService {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private extraction: ExtractionService,
    private embedding: EmbeddingService,
  ) {}
}
```

## Error Handling
- Throw NestJS exceptions: `NotFoundException`, `BadRequestException`, `UnauthorizedException`
- Services throw; controllers don't need try/catch (NestJS exception filter handles it)
- For Prisma errors, catch `PrismaClientKnownRequestError` with error codes

## User Identification
Most endpoints require `x-am-user-id` header:
```typescript
@Get()
async findAll(@Headers('x-am-user-id') userId: string) {
  if (!userId) throw new BadRequestException('x-am-user-id header required');
  return this.service.findAll(userId);
}
```

## Raw SQL for Vector Operations
pgvector operations use raw SQL through Prisma:
```typescript
const results = await this.prisma.$queryRaw`
  SELECT id, raw, 1 - (embedding <=> ${vector}::vector) as similarity
  FROM memory
  WHERE user_id = ${userId}
  ORDER BY embedding <=> ${vector}::vector
  LIMIT ${limit}
`;
```
