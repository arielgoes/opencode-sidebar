export interface ModelOption { id: string; label: string; contextLimit?: number; }
export interface ModelGroup { provider: string; label: string; models: ModelOption[]; }

export const PROVIDER_LABELS: Record<string, string> = {
  opencode: 'OpenCode Go',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google AI',
  groq: 'Groq',
  mistral: 'Mistral',
  xai: 'xAI',
  deepseek: 'DeepSeek',
  minimax: 'MiniMax',
  openrouter: 'OpenRouter',
};

const KNOWN_ORDER = Object.keys(PROVIDER_LABELS);

export function groupModels(models: ModelOption[]): ModelGroup[] {
  if (models.length === 0) return [];

  const map = new Map<string, ModelOption[]>();
  for (const m of models) {
    const slash = m.id.indexOf('/');
    const provider = slash >= 0 ? m.id.slice(0, slash) : 'other';
    if (!map.has(provider)) map.set(provider, []);
    map.get(provider)!.push(m);
  }

  const groups: ModelGroup[] = [];
  for (const [provider, grps] of map) {
    grps.sort((a, b) => a.label.localeCompare(b.label));
    const label = provider === 'other' ? 'Other' : (PROVIDER_LABELS[provider] ?? capitalize(provider));
    groups.push({ provider, label, models: grps });
  }

  groups.sort((a, b) => {
    const ai = KNOWN_ORDER.indexOf(a.provider);
    const bi = KNOWN_ORDER.indexOf(b.provider);
    if (ai >= 0 && bi >= 0) return ai - bi;
    if (ai >= 0) return -1;
    if (bi >= 0) return 1;
    return a.label.localeCompare(b.label);
  });

  return groups;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
