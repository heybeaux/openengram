import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

interface CloudAuthResponse {
  id: string;
  email: string;
  plan: string;
  name?: string;
}

export interface CloudStatus {
  linked: boolean;
  plan?: string;
  email?: string;
  lastVerified?: string;
}

@Injectable()
export class CloudLinkService {
  private readonly logger = new Logger(CloudLinkService.name);
  private readonly CLOUD_API_BASE = 'https://api.openengram.ai';

  constructor(private readonly prisma: PrismaService) {}

  async linkCloud(accountId: string, apiKey: string): Promise<CloudStatus> {
    // Validate the API key against cloud
    const cloudUser = await this.validateCloudApiKey(apiKey);

    // Encrypt the API key
    const encryptedKey = this.encrypt(apiKey);

    // Upsert the cloud link
    await this.prisma.cloudLink.upsert({
      where: { accountId },
      create: {
        accountId,
        cloudApiKey: encryptedKey,
        cloudAccountId: cloudUser.id,
        cloudEmail: cloudUser.email,
        cloudPlan: cloudUser.plan,
        lastVerifiedAt: new Date(),
      },
      update: {
        cloudApiKey: encryptedKey,
        cloudAccountId: cloudUser.id,
        cloudEmail: cloudUser.email,
        cloudPlan: cloudUser.plan,
        lastVerifiedAt: new Date(),
      },
    });

    return {
      linked: true,
      plan: cloudUser.plan,
      email: cloudUser.email,
      lastVerified: new Date().toISOString(),
    };
  }

  async unlinkCloud(accountId: string): Promise<void> {
    const existing = await this.prisma.cloudLink.findUnique({
      where: { accountId },
    });
    if (!existing) {
      throw new NotFoundException('No cloud link found');
    }
    await this.prisma.cloudLink.delete({ where: { accountId } });
  }

  async getStatus(accountId: string): Promise<CloudStatus> {
    const link = await this.prisma.cloudLink.findUnique({
      where: { accountId },
    });

    if (!link) {
      return { linked: false };
    }

    return {
      linked: true,
      plan: link.cloudPlan ?? undefined,
      email: link.cloudEmail ?? undefined,
      lastVerified: link.lastVerifiedAt?.toISOString(),
    };
  }

  async isAccountLinked(accountId: string): Promise<boolean> {
    const link = await this.prisma.cloudLink.findUnique({
      where: { accountId },
      select: { id: true },
    });
    return !!link;
  }

  /**
   * Re-validates the cloud API key. Call on-demand or via cron.
   */
  async refreshSubscription(accountId: string): Promise<CloudStatus> {
    const link = await this.prisma.cloudLink.findUnique({
      where: { accountId },
    });

    if (!link) {
      return { linked: false };
    }

    const apiKey = this.decrypt(link.cloudApiKey);

    try {
      const cloudUser = await this.validateCloudApiKey(apiKey);

      await this.prisma.cloudLink.update({
        where: { accountId },
        data: {
          cloudPlan: cloudUser.plan,
          cloudEmail: cloudUser.email,
          cloudAccountId: cloudUser.id,
          lastVerifiedAt: new Date(),
        },
      });

      return {
        linked: true,
        plan: cloudUser.plan,
        email: cloudUser.email,
        lastVerified: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.warn(
        `Cloud API key validation failed for account ${accountId}: ${error.message}`,
      );

      // Key is invalid — remove the link
      await this.prisma.cloudLink.delete({ where: { accountId } });

      return { linked: false };
    }
  }

  private async validateCloudApiKey(apiKey: string): Promise<CloudAuthResponse> {
    const response = await fetch(`${this.CLOUD_API_BASE}/v1/auth/me`, {
      headers: { 'X-AM-API-Key': apiKey },
    });

    if (!response.ok) {
      throw new BadRequestException('Invalid cloud API key');
    }

    const data = (await response.json()) as CloudAuthResponse;
    if (!data.id || !data.email) {
      throw new BadRequestException('Invalid response from cloud API');
    }

    return data;
  }

  // Simple AES-256-CBC encryption with ENCRYPTION_KEY from env
  private getEncryptionKey(): Buffer {
    const key = process.env.ENCRYPTION_KEY || 'engram-default-encryption-key-change-me';
    return scryptSync(key, 'engram-salt', 32);
  }

  private encrypt(text: string): string {
    const key = this.getEncryptionKey();
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-cbc', key, iv);
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
  }

  private decrypt(encrypted: string): string {
    const key = this.getEncryptionKey();
    const [ivHex, encHex] = encrypted.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const enc = Buffer.from(encHex, 'hex');
    const decipher = createDecipheriv('aes-256-cbc', key, iv);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  }
}
