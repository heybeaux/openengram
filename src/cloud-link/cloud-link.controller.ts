import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CloudLinkService } from './cloud-link.service';
import { AccountJwtGuard } from '../account/account.guard';

@ApiTags('cloud')
@Controller('v1/cloud')
@UseGuards(AccountJwtGuard)
@ApiBearerAuth()
export class CloudLinkController {
  constructor(private readonly cloudLinkService: CloudLinkService) {}

  @Post('link')
  @HttpCode(200)
  @ApiOperation({ summary: 'Link instance to OpenEngram Cloud' })
  async link(@Req() req: any, @Body() body: { apiKey: string }) {
    return this.cloudLinkService.linkCloud(req.accountId, body.apiKey);
  }

  @Delete('link')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Unlink instance from OpenEngram Cloud' })
  async unlink(@Req() req: any) {
    await this.cloudLinkService.unlinkCloud(req.accountId);
  }

  @Get('status')
  @ApiOperation({ summary: 'Get cloud link status' })
  async status(@Req() req: any) {
    return this.cloudLinkService.getStatus(req.accountId);
  }

  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Refresh cloud subscription status' })
  async refresh(@Req() req: any) {
    return this.cloudLinkService.refreshSubscription(req.accountId);
  }
}
