import { Global, Module } from '@nestjs/common';
import { KgController } from './kg.controller';
import { KgService } from './kg.service';
import { KgStaticService } from './kg-static.service';
import { KgObservationalService } from './kg-observational.service';

/**
 * Knowledge Graph module. PrismaService, RedisService, DeploymentService and
 * RolesService all come from @Global modules, so nothing extra to import.
 * Exported so connector lifecycle hooks / cron can trigger a sync.
 */
@Global()
@Module({
  controllers: [KgController],
  providers: [KgService, KgStaticService, KgObservationalService],
  exports: [KgService, KgStaticService, KgObservationalService],
})
export class KgModule {}
