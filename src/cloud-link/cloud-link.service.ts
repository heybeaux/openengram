import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { encrypt, decrypt } from '../common/encryption.util';
import { randomUUID } from 'crypto';

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
  private consecutiveAuthFailures = 0;
  private static readonly MAX_AUTH_FAILURES = 3;

  constructor(private readonly prisma: PrismaService) {}

  async linkCloud(accountId: string, apiKey: string): Promise<CloudStatus> {
    // Validate the API key against cloud
    const cloudUser = await this.validateCloudApiKey(apiKey);

    // Encrypt the instance API key (used for auth/refresh)
    const encryptedKey = encrypt(apiKey);

    // Upsert the cloud link (generate instanceId on first link)
    const existing = await this.prisma.cloudLink.findUnique({
      where: { accountId },
      select: { instanceId: true },
    });
    const instanceId = existing?.instanceId ?? randomUUID();

    // Create an instance sync key on the cloud for push operations
    let encryptedSyncKey: string | null = null;
    try {
      const hostname = require('os').hostname();
      const syncKeyResponse = await fetch(
        `${this.CLOUD_API_BASE}/v1/account/sync-keys`,
        {
          method: 'POST',
          headers: {
            'X-AM-API-Key': apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ instanceName: hostname }),
        },
      );
      if (syncKeyResponse.ok) {
        const syncKeyData = (await syncKeyResponse.json()) as { key: string };
        if (syncKeyData.key) {
          encryptedSyncKey = encrypt(syncKeyData.key);
          this.logger.log(
            `Created cloud sync key for instance ${hostname}`,
          );
        }
      } else {
        this.logger.warn(
          `Failed to create cloud sync key: ${syncKeyResponse.status} ${await syncKeyResponse.text().catch(() => '')}`,
        );
      }
    } catch (error: any) {
      this.logger.warn(`Failed to create cloud sync key: ${error.message}`);
    }

    await this.prisma.cloudLink.upsert({
      where: { accountId },
      create: {
        accountId,
        cloudApiKey: encryptedKey,
        cloudSyncKey: encryptedSyncKey,
        cloudAccountId: cloudUser.id,
        cloudEmail: cloudUser.email,
        cloudPlan: cloudUser.plan,
        instanceId,
        lastVerifiedAt: new Date(),
      },
      update: {
        cloudApiKey: encryptedKey,
        cloudSyncKey: encryptedSyncKey,
        cloudAccountId: cloudUser.id,
        cloudEmail: cloudUser.email,
        cloudPlan: cloudUser.plan,
        instanceId,
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
   * Distinguishes network errors from auth errors:
   * - Network errors: log warning, keep the link intact
   * - Auth errors (401/403): only unlink after 3 consecutive failures
   */
  async refreshSubscription(accountId: string): Promise<CloudStatus> {
    const link = await this.prisma.cloudLink.findUnique({
      where: { accountId },
    });

    if (!link) {
      return { linked: false };
    }

    const apiKey = decrypt(link.cloudApiKey);

    let response: Response;
    try {
      response = await fetch(`${this.CLOUD_API_BASE}/v1/auth/me`, {
        headers: { 'X-AM-API-Key': apiKey },
      });
    } catch (error: any) {
      // Network error / timeout — do NOT delete the link
      this.logger.warn(
        `Cloud API network error for account ${accountId}: ${error.message}. Keeping link intact.`,
      );
      return {
        linked: true,
        plan: link.cloudPlan ?? undefined,
        email: link.cloudEmail ?? undefined,
        lastVerified: link.lastVerifiedAt?.toISOString(),
      };
    }

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        this.consecutiveAuthFailures++;
        this.logger.warn(
          `Cloud API auth failure ${this.consecutiveAuthFailures}/${CloudLinkService.MAX_AUTH_FAILURES} for account ${accountId}`,
        );

        if (this.consecutiveAuthFailures >= CloudLinkService.MAX_AUTH_FAILURES) {
          this.logger.warn(
            `Unlinking cloud for account ${accountId} after ${CloudLinkService.MAX_AUTH_FAILURES} consecutive auth failures`,
          );
          this.consecutiveAuthFailures = 0;
          await this.prisma.cloudLink.delete({ where: { accountId } });
          return { linked: false };
        }

        // Not enough failures yet — keep the link
        return {
          linked: true,
          plan: link.cloudPlan ?? undefined,
          email: link.cloudEmail ?? undefined,
          lastVerified: link.lastVerifiedAt?.toISOString(),
        };
      }

      // Other HTTP errors (500, 502, etc.) — treat like network issues
      this.logger.warn(
        `Cloud API returned ${response.status} for account ${accountId}. Keeping link intact.`,
      );
      return {
        linked: true,
        plan: link.cloudPlan ?? undefined,
        email: link.cloudEmail ?? undefined,
        lastVerified: link.lastVerifiedAt?.toISOString(),
      };
    }

    // Success — reset failure counter
    this.consecutiveAuthFailures = 0;

    const cloudUser = (await response.json()) as CloudAuthResponse;
    if (!cloudUser.id || !cloudUser.email) {
      this.logger.warn(`Invalid response from cloud API for account ${accountId}`);
      return {
        linked: true,
        plan: link.cloudPlan ?? undefined,
        email: link.cloudEmail ?? undefined,
        lastVerified: link.lastVerifiedAt?.toISOString(),
      };
    }

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

  // Encryption now handled by shared encryption.util.ts
}
