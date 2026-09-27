import { util } from '@aws-appsync/utils';

// AppSync Events JS rejects the String constructor and C-style loops.
// Keep group checks to typeof / Array.isArray / includes / indexOf only.

function groupsAllow(raw, expected) {
  if (!raw || !expected) {
    return false;
  }
  if (typeof raw === 'string') {
    const padded = `,${raw},`;
    return padded.indexOf(`,${expected},`) >= 0 || padded.indexOf(`"${expected}"`) >= 0;
  }
  if (Array.isArray(raw)) {
    return raw.includes(expected);
  }
  return false;
}

export function onSubscribe(ctx) {
  const path = ctx.info?.channel?.path || '';
  const prefix = '/household/';
  const householdId = path.indexOf(prefix) === 0 ? path.substring(prefix.length) : '';
  const raw = ctx.identity?.claims?.['cognito:groups'];
  if (!householdId || householdId.indexOf('/') >= 0 || !groupsAllow(raw, `hh_${householdId}`)) {
    util.unauthorized();
  }
}

export function onPublish(ctx) {
  return ctx.events;
}
