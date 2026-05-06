// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { groupModels, PROVIDER_LABELS } from '../../webview/components/modelPickerUtil';

describe('groupModels', () => {
  it('groups models by provider from id', () => {
    const models = [
      { id: 'openai/gpt-4', label: 'GPT-4' },
      { id: 'openai/gpt-3.5', label: 'GPT-3.5' },
      { id: 'anthropic/claude', label: 'Claude' },
    ];
    const groups = groupModels(models);
    expect(groups).toHaveLength(2);
    expect(groups[0].provider).toBe('openai');
    expect(groups[0].label).toBe('OpenAI');
    expect(groups[0].models.map(m => m.id)).toEqual(['openai/gpt-3.5', 'openai/gpt-4']);
    expect(groups[1].provider).toBe('anthropic');
    expect(groups[1].models).toHaveLength(1);
  });

  it('puts models without slash into Other group', () => {
    const models = [{ id: 'unknown-model', label: 'Unknown' }];
    const groups = groupModels(models);
    expect(groups).toHaveLength(1);
    expect(groups[0].provider).toBe('other');
    expect(groups[0].label).toBe('Other');
  });

  it('sorts known providers before unknown', () => {
    const models = [
      { id: 'zeta/model', label: 'Z' },
      { id: 'openai/gpt-4', label: 'GPT-4' },
    ];
    const groups = groupModels(models);
    expect(groups[0].provider).toBe('openai');
    expect(groups[1].provider).toBe('zeta');
  });

  it('returns empty array for no models', () => {
    expect(groupModels([])).toEqual([]);
  });
});
