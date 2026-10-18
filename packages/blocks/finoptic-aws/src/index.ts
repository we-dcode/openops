import { BlockAuth, createBlock } from '@openops/blocks-framework';
import { BlockCategory } from '@openops/shared';
import { awsCall } from './lib/actions/aws-call';

export const finopticAws = createBlock({
  displayName: 'Finoptic AWS',
  description:
    'Runs AWS calls with short-lived credentials issued by the Finoptic broker',
  auth: BlockAuth.None(),
  minimumSupportedRelease: '0.20.0',
  logoUrl: '/blocks/aws.png',
  authors: ['finoptic'],
  categories: [BlockCategory.CLOUD],
  actions: [awsCall],
  triggers: [],
});
