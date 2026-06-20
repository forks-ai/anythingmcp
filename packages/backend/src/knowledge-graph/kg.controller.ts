import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { KgService } from './kg.service';

@ApiTags('Knowledge Graph')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('api/knowledge-graph')
export class KgController {
  constructor(private readonly kg: KgService) {}

  @Get()
  @Roles('ADMIN', 'EDITOR')
  @ApiOperation({ summary: 'Get the knowledge graph for the current workspace' })
  async getGraph(@Req() req: any) {
    return this.kg.getGraph(req.user.organizationId, req.user.sub);
  }

  @Get('stats')
  @Roles('ADMIN', 'EDITOR')
  @ApiOperation({ summary: 'Graph counts (nodes, edges, suggested)' })
  async stats(@Req() req: any) {
    return this.kg.stats(req.user.organizationId);
  }

  @Post('rebuild')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Rebuild the graph (static + observational)' })
  async rebuild(@Req() req: any) {
    return this.kg.rebuild(req.user.organizationId);
  }

  @Post('edges')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Create a manual link between two entities' })
  async createEdge(
    @Req() req: any,
    @Body() body: { sourceNodeId: string; targetNodeId: string; kind?: string },
  ) {
    return this.kg.createManualEdge(req.user.organizationId, body);
  }

  @Patch('edges/:id')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Confirm or reject a suggested edge' })
  async setStatus(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { status: 'active' | 'rejected' },
  ) {
    return this.kg.setEdgeStatus(req.user.organizationId, id, body.status);
  }

  @Delete('edges/:id')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Delete an edge' })
  async deleteEdge(@Req() req: any, @Param('id') id: string) {
    return this.kg.deleteEdge(req.user.organizationId, id);
  }
}
