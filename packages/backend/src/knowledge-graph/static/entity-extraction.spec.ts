import { extractEntity, singularize } from './entity-extraction';
import { fkCandidate } from './fk-inference';

describe('singularize', () => {
  it.each([
    ['persons', 'person'],
    ['organizations', 'organization'],
    ['activities', 'activity'],
    ['categories', 'category'],
    ['companies', 'company'],
    ['addresses', 'address'],
    ['methods', 'method'],
    ['deals', 'deal'],
    ['status', 'status'], // must not strip the trailing s
    ['analysis', 'analysis'], // -is words must survive
    ['business', 'business'],
  ])('%s -> %s', (input, expected) => {
    expect(singularize(input)).toBe(expected);
  });
});

describe('extractEntity', () => {
  it.each([
    // verb-first, the dominant convention
    ['pipedrive_list_deals', 'pipedrive', 'deal'],
    ['pipedrive_create_organization', 'pipedrive', 'organization'],
    ['trello_create_card', 'trello', 'card'],
    ['zendesk_create_ticket', 'zendesk', 'ticket'],
    ['mollie_create_customer', 'mollie', 'customer'],
    // modifiers and verb connectors
    ['woocommerce_batch_update_products', 'woocommerce', 'product'],
    ['zendesk_create_or_update_user', 'zendesk', 'user'],
    // compound entities
    ['woocommerce_create_product_variation', 'woocommerce', 'product_variation'],
    ['clickup_create_task_comment', 'clickup', 'task_comment'],
    // noun-first payment style
    ['adyen_payment_methods', 'adyen', 'payment_method'],
    ['adyen_payments_capture', 'adyen', 'payment'],
  ])('%s -> %s', (tool, slug, expected) => {
    expect(extractEntity(tool, slug)?.entity).toBe(expected);
  });

  it.each([
    ['pipedrive_search', 'pipedrive'], // universal search, no noun
    ['pipedrive_list_deal_fields', 'pipedrive'], // metadata helper
    ['pipedrive_get_current_user', 'pipedrive'], // identity probe
    ['coda_whoami', 'coda'],
    ['trello_get_me', 'trello'],
    ['woocommerce_skill_revenue_kpi_snapshot', 'woocommerce'], // composite workflow tool
  ])('%s -> null (utility/metadata)', (tool, slug) => {
    expect(extractEntity(tool, slug)).toBeNull();
  });
});

describe('fkCandidate', () => {
  it.each([
    ['person_id', 'person'],
    ['org_id', 'organization'], // alias
    ['stage_id', 'stage'],
    ['customerId', 'customer'],
    ['mandateId', 'mandate'],
    ['idList', 'list'],
    ['idBoard', 'board'],
    ['shopperReference', 'shopper'],
  ])('%s -> %s', (field, expected) => {
    expect(fkCandidate(field)).toBe(expected);
  });

  it.each([['id'], ['name'], ['email'], ['status'], ['type'], ['parent'], ['limit']])(
    '%s -> null (generic, never a join key)',
    (field) => {
      expect(fkCandidate(field)).toBeNull();
    },
  );
});
