import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

export interface InstanceInfo {
  mode: 'cloud' | 'self-hosted';
  version: string;
  features: {
    localEmbeddings: boolean;
    cloudEnsemble: boolean;
    codeSearch: boolean;
    cloudBackup: boolean;
    crossDeviceSync: boolean;
    billing: boolean;
  };
  cloudLinked: boolean;
}

@Injectable()
export class InstanceService {
  private readonly version: string;

  constructor() {
    try {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8'),
      );
      this.version = pkg.version || '0.0.0';
    } catch {
      this.version = '0.0.0';
    }
  }

  getInfo(): InstanceInfo {
    const mode = this.getMode();
    const cloudLinked = this.isCloudLinked();

    return {
      mode,
      version: this.version,
      features: this.getFeatures(mode, cloudLinked),
      cloudLinked,
    };
  }

  getMode(): 'cloud' | 'self-hosted' {
    return process.env.DEPLOYMENT_MODE === 'cloud' ? 'cloud' : 'self-hosted';
  }

  isCloudLinked(): boolean {
    // Linking comes in HEY-66, hardcoded false for now
    return false;
  }

  getFeatures(
    mode: 'cloud' | 'self-hosted',
    cloudLinked: boolean,
  ): InstanceInfo['features'] {
    if (mode === 'cloud') {
      return {
        localEmbeddings: false,
        cloudEnsemble: true,
        codeSearch: false,
        cloudBackup: true,
        crossDeviceSync: true,
        billing: true,
      };
    }

    // self-hosted
    if (cloudLinked) {
      return {
        localEmbeddings: true,
        cloudEnsemble: true,
        codeSearch: true,
        cloudBackup: true,
        crossDeviceSync: true,
        billing: true,
      };
    }

    return {
      localEmbeddings: true,
      cloudEnsemble: false,
      codeSearch: true,
      cloudBackup: false,
      crossDeviceSync: false,
      billing: false,
    };
  }
}
