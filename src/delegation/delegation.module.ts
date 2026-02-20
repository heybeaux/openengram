import { Module } from '@nestjs/common';
import { TaskController } from './task.controller';
import { TemplateController } from './template.controller';
import { ContractController } from './contract.controller';
import { TaskService } from './task.service';
import { TemplateService } from './template.service';
import { ContractService } from './contract.service';

@Module({
  controllers: [TaskController, TemplateController, ContractController],
  providers: [TaskService, TemplateService, ContractService],
  exports: [TaskService, TemplateService, ContractService],
})
export class DelegationModule {}
