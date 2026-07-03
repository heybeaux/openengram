import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { TemplateService } from './template.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';
import { ApiKeyOrJwtGuard } from '../common/guards/api-key-or-jwt.guard';
import { UserId } from '../common/decorators/user-id.decorator';

@Controller('v1/delegation-templates')
@UseGuards(ApiKeyOrJwtGuard)
export class TemplateController {
  constructor(private readonly templateService: TemplateService) {}

  @Post()
  create(@UserId() userId: string, @Body() dto: CreateTemplateDto) {
    return this.templateService.create(userId, dto);
  }

  @Get()
  findAll(@UserId() userId: string) {
    return this.templateService.findAll(userId);
  }

  @Get(':id')
  findOne(@UserId() userId: string, @Param('id') id: string) {
    return this.templateService.findOne(userId, id);
  }

  @Patch(':id')
  update(
    @UserId() userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateTemplateDto,
  ) {
    return this.templateService.update(userId, id, dto);
  }

  @Delete(':id')
  remove(@UserId() userId: string, @Param('id') id: string) {
    return this.templateService.remove(userId, id);
  }
}
