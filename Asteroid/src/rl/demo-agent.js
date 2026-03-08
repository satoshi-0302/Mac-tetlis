import { createPolicyControllerFromModel } from './policy-model.js';

const DEFAULT_POLICY_URL = '/rl/demo-policy.json';

export async function loadDemoAgent(policyUrl = DEFAULT_POLICY_URL) {
  const response = await fetch(policyUrl, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Demo policy request failed (${response.status})`);
  }

  const policy = await response.json();
  return {
    policy,
    agent: createPolicyControllerFromModel(policy)
  };
}
