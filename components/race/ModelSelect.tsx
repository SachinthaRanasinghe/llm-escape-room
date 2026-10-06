import type { ProviderCatalogue } from '@/lib/race/wire';
import { encodePick, usd } from './picks';
import styles from './race.module.css';

/**
 * One model picker, grouped by provider and by free / paid — shared by the race
 * (two lanes) and the arena (three). A provider without its key is listed but
 * disabled, so the page says what to set rather than hiding the models.
 */
export function ModelSelect({
  id,
  label,
  lane,
  value,
  onChange,
  providers,
}: {
  id: string;
  label: string;
  lane: 'a' | 'b' | 'c';
  value: string;
  onChange: (value: string) => void;
  providers: readonly ProviderCatalogue[];
}) {
  return (
    <label className={styles.picker} data-lane={lane} htmlFor={id}>
      <span className={styles.pickerLabel}>{label}</span>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} data-testid={`${id}-select`}>
        <option value="" disabled>
          Choose a model…
        </option>
        {providers.flatMap((provider) =>
          (['free', 'paid'] as const).map((kind) => {
            const models = provider.models.filter((m) => (m.price === null) === (kind === 'free'));
            if (models.length === 0) return null;
            const name = kind === 'paid' ? `${provider.name} — paid` : provider.name;
            return (
              <optgroup
                key={`${provider.provider}-${kind}`}
                label={provider.keySet ? `${name} (${models.length})` : `${name} — set ${provider.keyVar} to use`}
              >
                {models.map((model) => (
                  <option
                    key={model.modelId}
                    value={encodePick({ provider: provider.provider, modelId: model.modelId })}
                    disabled={!provider.keySet}
                  >
                    {model.label === model.modelId ? model.modelId : `${model.label} — ${model.modelId}`}
                    {model.price !== null && ` · ${usd(model.price.promptPerMTok)}/${usd(model.price.completionPerMTok)} per M`}
                  </option>
                ))}
              </optgroup>
            );
          }),
        )}
      </select>
    </label>
  );
}
