import { Module } from '@nestjs/common';
import { McpServersService } from './mcp-servers.service';
import { McpServersController } from './mcp-servers.controller';
import { McpSessionManager } from './mcp-session.manager';
import { LicenseModule } from '../license/license.module';

@Module({
  imports: [LicenseModule],
  providers: [McpServersService, McpSessionManager],
  controllers: [McpServersController],
  exports: [McpServersService, McpSessionManager],
})
export class McpServersModule {}
