<script lang="ts">
  import { getChatContext } from '@chatkit-svelte/svelte';
  import { untrack } from 'svelte';
  import { defaultMessages } from '@chatkit-svelte/core';
  import type { ArtifactRecord, ContentPart } from '@chatkit-svelte/core';
  import type { FormArtifactData } from './types';
  import { validateForm } from './validate';

  interface Props {
    artifact: ArtifactRecord;
    onBeforeSubmit?: (values: Record<string, unknown>) => Record<string, unknown> | Promise<Record<string, unknown>>;
  }

  let { artifact, onBeforeSubmit }: Props = $props();
  const store = getChatContext();

  const data = $derived(artifact.data as FormArtifactData);
  const properties = $derived((data.schema.properties as Record<string, Record<string, unknown>>) ?? {});
  const fieldOrder = $derived(data.uiSchema?.order ?? Object.keys(properties));
  const submitted = $derived(artifact.status === 'submitted');
  const submittedValues = $derived((data.values ?? {}) as Record<string, unknown>);

  // Seeded once from the artifact's initial values, deliberately not kept in
  // sync if `data` changes later — this is local in-progress edit state, not
  // a mirror of the artifact.
  let values: Record<string, unknown> = $state(untrack(() => ({ ...(data.initialValues ?? {}) })));
  let errors: Record<string, string> = $state({});
  let touched: Record<string, boolean> = $state({});

  function widgetFor(field: string, fieldSchema: Record<string, unknown>): string {
    const override = data.uiSchema?.widgets?.[field];
    if (override) return override;
    if (fieldSchema.enum) return 'select';
    if (fieldSchema.type === 'boolean') return 'checkbox';
    if (fieldSchema.type === 'string' && fieldSchema.format === 'date') return 'date';
    return 'text';
  }

  // validate.ts has no store access, so its returned messages are always
  // the default English text; this localizes just the one message key that
  // has a real translation slot today (form.validation.required) rather
  // than changing validate()'s signature — see the M6 plan's Task 3 Step 7.
  function localize(message: string): string {
    return message === defaultMessages['form.validation.required'] ? store.t('form.validation.required') : message;
  }

  function validateOne(field: string) {
    const fieldErrors = validateForm(data.schema, values);
    errors = { ...errors, [field]: fieldErrors[field] ? localize(fieldErrors[field]) : '' };
  }

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    const fieldErrors = validateForm(data.schema, values);
    errors = Object.fromEntries(Object.entries(fieldErrors).map(([field, message]) => [field, localize(message)]));
    touched = Object.fromEntries(fieldOrder.map((f) => [f, true]));
    if (Object.keys(fieldErrors).length > 0) return;

    const finalValues = onBeforeSubmit ? await onBeforeSubmit(values) : values;

    store.dispatch({ type: 'CUSTOM', name: 'chatkit.form.result', payload: { artifactId: artifact.id, values: finalValues } });

    const attachments: ContentPart[] = [
      { type: 'custom', name: 'chatkit.form.result', payload: { artifactId: artifact.id, values: finalValues } },
    ];
    await store.sendMessage({ text: '', attachments });
  }
</script>

<form class="ck-form" onsubmit={handleSubmit}>
  {#each fieldOrder as field (field)}
    {@const fieldSchema = properties[field] ?? {}}
    {@const widget = widgetFor(field, fieldSchema)}
    <label class="ck-form__field">
      <span class="ck-form__label">{(fieldSchema.title as string) ?? field}</span>
      {#if submitted}
        <span class="ck-form__value" data-testid="form-value-{field}">{String(submittedValues[field] ?? '')}</span>
      {:else if widget === 'select'}
        <select bind:value={values[field]} onblur={() => validateOne(field)} aria-label={field}>
          {#each (fieldSchema.enum as unknown[]) ?? [] as option}
            <option value={option}>{String(option)}</option>
          {/each}
        </select>
      {:else if widget === 'checkbox'}
        <input type="checkbox" bind:checked={values[field] as boolean} aria-label={field} />
      {:else if widget === 'textarea'}
        <textarea bind:value={values[field]} onblur={() => validateOne(field)} aria-label={field}></textarea>
      {:else if widget === 'date'}
        <input type="date" bind:value={values[field]} onblur={() => validateOne(field)} aria-label={field} />
      {:else}
        <input type="text" bind:value={values[field]} onblur={() => validateOne(field)} aria-label={field} />
      {/if}
      {#if touched[field] && errors[field]}
        <span class="ck-form__error" data-testid="form-error-{field}">{errors[field]}</span>
      {/if}
    </label>
  {/each}
  {#if !submitted}
    <button type="submit">{data.submitLabel ?? store.t('form.submit')}</button>
  {/if}
</form>

<style>
  .ck-form {
    display: flex;
    flex-direction: column;
    gap: var(--ck-space-3);
  }

  .ck-form__field {
    display: flex;
    flex-direction: column;
    gap: var(--ck-space-1);
  }

  .ck-form__label {
    font-size: var(--ck-font-size-sm);
    color: var(--ck-color-text-muted);
  }

  .ck-form input,
  .ck-form select,
  .ck-form textarea {
    border: 1px solid var(--ck-color-border);
    border-radius: var(--ck-radius-sm);
    padding: var(--ck-space-2);
    font-size: var(--ck-font-size-base);
    background: var(--ck-color-bg);
    color: var(--ck-color-text);
  }

  .ck-form__error {
    color: var(--ck-color-error);
    font-size: var(--ck-font-size-sm);
  }

  .ck-form button[type='submit'] {
    align-self: flex-start;
    background: var(--ck-color-accent);
    color: var(--ck-color-accent-contrast);
    border: none;
    border-radius: var(--ck-radius-sm);
    padding: var(--ck-space-2) var(--ck-space-4);
    cursor: pointer;
  }
</style>
