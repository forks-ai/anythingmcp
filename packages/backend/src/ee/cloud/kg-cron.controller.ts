import {
  Controller,
  Post,
  Headers,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { KgCronService } from './kg-cron.service';

/**
 * POST /api/cron/kg-discovery
 *
 * Cloud-only maintenance for the Knowledge Graph + audit retention. Triggered
 * by a scheduled GitHub Actions workflow. Auth: `Authorization: Bearer
 * <CRON_SECRET>` — self-host deployments don't set CRON_SECRET, so the endpoint
 * refuses anonymous calls there too (effectively cloud-only).
 */
@ApiTags('Cron')
@Controller('api/cron')
export class KgCronController {
  private readonly logger = new Logger(KgCronController.name);

  constructor(private readonly cron: KgCronService) {}

  @Post('kg-discovery')
  @ApiOperation({
    summary:
      'Refresh the knowledge graph (static + observational) for a batch of orgs and prune stale data',
  })
  async run(@Headers('authorization') authHeader?: string) {
    const expected = process.env.CRON_SECRET;
    if (!expected) {
      this.logger.warn('CRON_SECRET is not configured — refusing kg-discovery cron call.');
      throw new UnauthorizedException('Cron not configured');
    }
    const provided = authHeader?.startsWith('Bearer ') && authHeader.substring(7);
    if (provided !== expected) {
      throw new UnauthorizedException('Invalid cron token');
    }

    const result = await this.cron.run();
    return { ok: true, ...result };
  }
}
