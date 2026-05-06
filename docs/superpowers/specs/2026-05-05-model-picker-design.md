# Model Picker Design

## Overview

Replace the Composer `<select>` dropdown with a rich model picker panel that opens from a button in the Composer row. Models are grouped by provider with a search bar, matching the reference screenshot.

## Architecture

### New Component: `ModelPicker.ts`

A floating panel mounted inside the Composer container. The panel is absolutely positioned above the Composer row and toggles open/closed via a button.

**Panel structure:**
```
──────────────────────────────────┐
│ 🔍 Search models          +    │  ← top bar
├──────────────────────────────────┤
│ OpenCode Go                       │  ← provider header
│ MiniMax M2.7                      │
│ Qwen3.5 Plus                      │
│ Qwen3.6 Plus                ✓     │  ← selected model
├──────────────────────────────────┤
│ OpenRouter                        │  ← provider header
│ Claude Opus 4.7                   │
│ Claude Sonnet 4.6                 │
└──────────────────────────────────┘
```

### State Changes

Add `modelPickerOpen: boolean` to `State` interface and `initialState()`.

No bridge protocol changes needed — the picker is fully client-side.

### Data Flow

1. `availableModels` arrives via `ready` event (flat array `{id, label}`)
2. `ModelPicker` groups models by parsing `id` as `provider/model`
3. Provider IDs mapped to friendly names via a local map (subset of `PROVIDER_INFO` from extension.ts)
4. Selected model tracked by `state.composer.model`
5. On model click: dispatch `ready` event with new `defaultModel` (reuses existing Composer pattern)

### Provider Grouping Logic

```typescript
function groupModels(models: Array<{id: string; label: string}>): Array<{provider: string; label: string; models: Array<{id: string; label: string}>}> {
  // Parse "provider/model" from id
  // Group by provider
  // Sort groups: known providers first (opencode, openai, anthropic, etc.), then unknown
  // Sort models within group by label
}
```

Provider ID → friendly name map (subset):
- `opencode` → "OpenCode Go"
- `openai` → "OpenAI"
- `anthropic` → "Anthropic"
- `google` → "Google AI"
- `groq` → "Groq"
- `mistral` → "Mistral"
- `xai` → "xAI"
- `deepseek` → "DeepSeek"
- `minimax` → "MiniMax"
- `openrouter` → "OpenRouter"
- fallback → capitalized provider ID

### Files Changed

| File | Change |
|------|--------|
| `src/webview/state.ts` | Add `modelPickerOpen: boolean` to State and initialState |
| `src/webview/components/Composer.ts` | Replace `<select>` with trigger button + mount ModelPicker |
| `src/webview/components/ModelPicker.ts` | **New** — panel component with search, grouping, selection |
| `src/webview/ui.css` | Add styles for model picker panel, provider headers, search bar |

### Component Behavior

**Opening/closing:**
- Click trigger button → toggle `modelPickerOpen`
- Click outside panel → close (global click listener)
- Press Escape → close
- Selecting a model → close panel

**Search:**
- Filters models across all groups in real-time
- Hides empty provider groups
- Case-insensitive match on model label

**Selection:**
- Click model row → update `composer.model`, re-dispatch `ready` event (existing pattern), close panel
- Visual checkmark (✓) on selected model

### CSS Approach

- Panel: `position: absolute; bottom: 100%; left: 0; right: 0;` — sits above Composer row
- Uses `--vscode-*` CSS variables for theming
- Provider headers: muted, small font, uppercase
- Model rows: hover background, selected row has subtle highlight
- Search input: styled like VS Code input
- Max height with scroll if many models

### Error Handling

- If `availableModels` is empty: show "(no models available)" in panel
- If model ID has no `/` separator: group under "Other"
- Search with no results: show "(no matching models)"
