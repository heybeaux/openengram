import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Headers,
  HttpException,
  HttpStatus,
  Query,
} from '@nestjs/common';
import { WebhookService } from './webhook.service';
import { WebhookDeliveryService } from './webhook-delivery.service';
import { CreateWebhookDto, UpdateWebhookDto } from './dto/webhook.dto';

@Controller('v1/webhooks')
export class WebhookController {
  constructor(
    private webhookService: WebhookService,
    private deliveryService: WebhookDeliveryService,
  ) {}

  private getUserId(headers: Record<string, string>): string {
    const userId = headers['x-am-user-id'];
    if (!userId) {
      throw new HttpException(
        'X-AM-User-ID header is required',
        HttpStatus.UNAUTHORIZED,
      );
    }
    return userId;
  }

  @Post()
  async create(
    @Headers() headers: Record<string, string>,
    @Body() dto: CreateWebhookDto,
  ) {
    const userId = this.getUserId(headers);
    try {
      return await this.webhookService.create(userId, dto);
    } catch (err: any) {
      throw new HttpException(err.message, HttpStatus.BAD_REQUEST);
    }
  }

  @Get()
  async list(@Headers() headers: Record<string, string>) {
    const userId = this.getUserId(headers);
    return this.webhookService.list(userId);
  }

  @Get(':id')
  async getById(
    @Headers() headers: Record<string, string>,
    @Param('id') id: string,
  ) {
    const userId = this.getUserId(headers);
    const sub = await this.webhookService.getById(id, userId);
    if (!sub) {
      throw new HttpException('Not found', HttpStatus.NOT_FOUND);
    }
    return sub;
  }

  @Patch(':id')
  async update(
    @Headers() headers: Record<string, string>,
    @Param('id') id: string,
    @Body() dto: UpdateWebhookDto,
  ) {
    const userId = this.getUserId(headers);
    try {
      return await this.webhookService.update(id, userId, dto);
    } catch (err: any) {
      throw new HttpException(err.message, HttpStatus.NOT_FOUND);
    }
  }

  @Delete(':id')
  async delete(
    @Headers() headers: Record<string, string>,
    @Param('id') id: string,
  ) {
    const userId = this.getUserId(headers);
    try {
      return await this.webhookService.delete(id, userId);
    } catch (err: any) {
      throw new HttpException(err.message, HttpStatus.NOT_FOUND);
    }
  }

  @Post(':id/test')
  async test(
    @Headers() headers: Record<string, string>,
    @Param('id') id: string,
  ) {
    const userId = this.getUserId(headers);
    try {
      return await this.deliveryService.sendTestEvent(id, userId);
    } catch (err: any) {
      throw new HttpException(err.message, HttpStatus.NOT_FOUND);
    }
  }

  @Get(':id/deliveries')
  async deliveries(
    @Headers() headers: Record<string, string>,
    @Param('id') id: string,
    @Query('limit') limit?: string,
  ) {
    const userId = this.getUserId(headers);
    try {
      return await this.webhookService.getDeliveries(
        id,
        userId,
        limit ? parseInt(limit, 10) : 50,
      );
    } catch (err: any) {
      throw new HttpException(err.message, HttpStatus.NOT_FOUND);
    }
  }
}
