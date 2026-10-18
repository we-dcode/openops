import { BlockAuth, createBlock } from '@openops/blocks-framework';
import { BlockCategory } from '@openops/shared';
import { supervisorApproval } from './lib/actions/supervisor-approval';

export const finopticApproval = createBlock({
  displayName: 'Finoptic Approval',
  description: 'Supervisor approval gate for Finoptic automations',
  auth: BlockAuth.None(),
  minimumSupportedRelease: '0.20.0',
  logoUrl: '/blocks/approval-block.svg',
  authors: ['finoptic'],
  categories: [BlockCategory.CORE],
  actions: [supervisorApproval],
  triggers: [],
});
