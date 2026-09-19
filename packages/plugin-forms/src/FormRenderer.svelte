<script lang="ts">
  import { getChatContext } from '@chatkit-svelte/svelte';
  import { untrack } from 'svelte';
  import { defaultMessages } from '@chatkit-svelte/core';
  import type { ArtifactRecord, ContentPart } from '@chatkit-svelte/core';
  import type { FormArtifactData } from './types';
  import { validateForm } from './validate';
  import { gradeForm } from './grade';

  interface Props {
    artifact: ArtifactRecord;
    onBeforeSubmit?: (values: Record<string, unknown>) => Record<string, unknown> | Promise<Record<string, unknown>>;
    /**
     * Replaces the default submit target (chatkit.form.result CUSTOM event +
     * store.sendMessage) with a caller-supplied one, given the final values
     * (post onBeforeSubmit). Used by plugin-forms's show_form tool renderer
     * to route submission through store.editAndRetry instead, so the same
     * validation/widget/harvesting logic here serves both "the agent
     * streamed a form artifact" and "the agent called a tool asking for
     * structured input" without duplicating any of it.
     */
    onSubmitOverride?: (values: Record<string, unknown>) => void | Promise<void>;
  }

  let { artifact, onBeforeSubmit, onSubmitOverride }: Props = $props();
  const store = getChatContext();

  const data = $derived(artifact.data as FormArtifactData);
  const properties = $derived((data.schema?.properties as Record<string, Record<string, unknown>>) ?? {});
  const fieldOrder = $derived(data.uiSchema?.order ?? Object.keys(properties));
  const submitted = $derived(artifact.status === 'submitted');
  const submittedValues = $derived((data.values ?? {}) as Record<string, unknown>);
  const grade = $derived(submitted && data.answerKey ? gradeForm(data.answerKey, submittedValues) : null);

  // Seeded once from the artifact's initial values, deliberately not kept in
  // sync if `data` changes later — this is local in-progress edit state, not
  // a mirror of the artifact.
  let values: Record<string, unknown> = $state(untrack(() => ({ ...(data.initialValues ?? {}) })));
  let errors: Record<string, string> = $state({});
  let touched: Record<string, boolean> = $state({});
  let htmlContainer: HTMLDivElement | undefined = $state();

  // A full HTML document string only needs its body — DOMParser handles
  // whatever the document looks like (fragment, full doc, missing tags)
  // without us having to guess at its shape. Scripts inside are parsed but
  // inert (a script tag pulled from one document into another via
  // innerHTML-style insertion never executes) — this renders as real markup
  // on the real page, not a program, so there is nothing here to sandbox or
  // strip: no script runs, so there's no script to run harm.
  const htmlBody = $derived.by(() => {
    if (!data.html) return '';
    return new DOMParser().parseFromString(data.html, 'text/html').body.innerHTML;
  });

  function widgetFor(field: string, fieldSchema: Record<string, unknown>): string {
    const override = data.uiSchema?.widgets?.[field];
    if (override) return override;
    if (fieldSchema.type === 'array' && (fieldSchema.items as Record<string, unknown> | undefined)?.enum) return 'checkbox-group';
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
    const fieldErrors = validateForm(data.schema ?? {}, values);
    errors = { ...errors, [field]: fieldErrors[field] ? localize(fieldErrors[field]) : '' };
  }

  // Shared by both submit paths — a native schema-driven Submit click and
  // the harvested values from an html-mode body (see harvestHtmlValues below)
  // — so the agent sees the
  // exact same chatkit.form.result shape regardless of which rendering mode
  // produced it.
  async function submitResult(rawValues: Record<string, unknown>) {
    const finalValues = onBeforeSubmit ? await onBeforeSubmit(rawValues) : rawValues;

    if (onSubmitOverride) {
      await onSubmitOverride(finalValues);
      return;
    }

    store.dispatch({ type: 'CUSTOM', name: 'chatkit.form.result', payload: { artifactId: artifact.id, values: finalValues } });

    const attachments: ContentPart[] = [
      { type: 'custom', name: 'chatkit.form.result', payload: { artifactId: artifact.id, values: finalValues } },
    ];
    await store.sendMessage({ text: '', attachments });
  }

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    const fieldErrors = validateForm(data.schema ?? {}, values);
    errors = Object.fromEntries(Object.entries(fieldErrors).map(([field, message]) => [field, localize(message)]));
    touched = Object.fromEntries(fieldOrder.map((f) => [f, true]));
    if (Object.keys(fieldErrors).length > 0) return;

    await submitResult(values);
  }

  // The rendered html is real DOM in this same document now, not walled off
  // in a frame — so getting the answers back is just reading the inputs
  // directly, the same way you'd read any form. Doesn't matter what (if any)
  // script the source document had; we never rely on it. Multiple
  // same-name checkboxes are treated as a multi-select (array of the
  // checked ones' values), a lone same-name checkbox as a boolean, and only
  // the checked radio in a same-name group is recorded — mirroring how a
  // real <form> would submit these.
  function harvestHtmlValues(container: HTMLElement): Record<string, unknown> {
    const values: Record<string, unknown> = {};
    const seenCheckboxGroups = new Set<string>();
    const fields = Array.from(
      container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input[name], textarea[name], select[name]')
    );
    for (const field of fields) {
      const name = field.name;
      if (field instanceof HTMLInputElement && field.type === 'checkbox') {
        if (seenCheckboxGroups.has(name)) continue;
        seenCheckboxGroups.add(name);
        const group = container.querySelectorAll<HTMLInputElement>(`input[type="checkbox"][name="${CSS.escape(name)}"]`);
        values[name] =
          group.length > 1 ? Array.from(group).filter((cb) => cb.checked).map((cb) => cb.value) : group[0].checked;
        continue;
      }
      if (field instanceof HTMLInputElement && field.type === 'radio') {
        if (field.checked) values[name] = field.value;
        continue;
      }
      if (field instanceof HTMLSelectElement && field.multiple) {
        values[name] = Array.from(field.selectedOptions).map((o) => o.value);
        continue;
      }
      values[name] = field.value;
    }
    return values;
  }

  async function handleHtmlSubmit() {
    if (!htmlContainer) return;
    await submitResult(harvestHtmlValues(htmlContainer));
  }
</script>

{#if data.html}
  {#if submitted}
    <div class="ck-form__html-result" data-testid="form-html-result">
      <p class="ck-form__score">{store.t('form.html.submitted')}</p>
      <pre class="ck-form__html-result-values" data-testid="form-html-result-values">{JSON.stringify(submittedValues, null, 2)}</pre>
    </div>
  {:else}
    <div class="ck-form__html-body" bind:this={htmlContainer} data-testid="form-html-body">
      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
      {@html htmlBody}
    </div>
    <button type="button" class="ck-form__html-submit" data-testid="form-html-submit" onclick={handleHtmlSubmit}>
      {data.submitLabel ?? store.t('form.submit')}
    </button>
  {/if}
{:else}
<form class="ck-form" onsubmit={handleSubmit}>
  {#if data.audio}
    <div class="ck-form__audio">
      {#if data.audio.label}<span class="ck-form__audio-label">{data.audio.label}</span>{/if}
      <audio controls src={data.audio.url} data-testid="form-audio"></audio>
    </div>
  {/if}
  {#each fieldOrder as field (field)}
    {@const fieldSchema = properties[field] ?? {}}
    {@const widget = widgetFor(field, fieldSchema)}
    {@const fieldGrade = grade?.fields[field]}
    {@const isGroupWidget = widget === 'radio' || widget === 'checkbox-group'}
    <!-- A <label> must wrap exactly one control. radio/checkbox-group already
         provide their own role + aria-label on the group and a real <label>
         per option, so wrapping them in another outer <label> would make
         browsers fold this field's title text into the accessible name of
         whichever option happens to be first in the group. -->
    <svelte:element this={isGroupWidget ? 'div' : 'label'} class="ck-form__field">
      <span class="ck-form__label">{(fieldSchema.title as string) ?? field}</span>
      {#if submitted}
        <span class="ck-form__value" data-testid="form-value-{field}">
          {Array.isArray(submittedValues[field]) ? (submittedValues[field] as unknown[]).join(', ') : String(submittedValues[field] ?? '')}
        </span>
        {#if fieldGrade}
          <span
            class="ck-form__grade {fieldGrade.correct ? 'ck-form__grade--correct' : 'ck-form__grade--incorrect'}"
            data-testid="form-grade-{field}"
          >
            {fieldGrade.correct
              ? '✓'
              : `✗ correct answer: ${Array.isArray(fieldGrade.expected) ? fieldGrade.expected.join(', ') : String(fieldGrade.expected)}`}
          </span>
        {/if}
      {:else if widget === 'select'}
        <select bind:value={values[field]} onblur={() => validateOne(field)} aria-label={field}>
          {#each (fieldSchema.enum as unknown[]) ?? [] as option}
            <option value={option}>{String(option)}</option>
          {/each}
        </select>
      {:else if widget === 'radio'}
        <div class="ck-form__radio-group" role="radiogroup" aria-label={field}>
          {#each (fieldSchema.enum as unknown[]) ?? [] as option}
            <label class="ck-form__radio-option">
              <input type="radio" name={field} value={option} bind:group={values[field]} onchange={() => validateOne(field)} />
              {String(option)}
            </label>
          {/each}
        </div>
      {:else if widget === 'checkbox-group'}
        {@const optionList = ((fieldSchema.items as Record<string, unknown> | undefined)?.enum as unknown[]) ?? []}
        <div class="ck-form__checkbox-group" role="group" aria-label={field}>
          {#each optionList as option}
            <label class="ck-form__checkbox-option">
              <input
                type="checkbox"
                checked={((values[field] as unknown[] | undefined) ?? []).includes(option)}
                onchange={(event) => {
                  const current = (values[field] as unknown[] | undefined) ?? [];
                  values[field] = (event.currentTarget as HTMLInputElement).checked
                    ? [...current, option]
                    : current.filter((v) => v !== option);
                  validateOne(field);
                }}
              />
              {String(option)}
            </label>
          {/each}
        </div>
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
    </svelte:element>
  {/each}
  {#if submitted && grade}
    <p class="ck-form__score" data-testid="form-score">{store.t('form.score', { correct: String(grade.correctCount), total: String(grade.total) })}</p>
  {/if}
  {#if !submitted}
    <button type="submit">{data.submitLabel ?? store.t('form.submit')}</button>
  {/if}
</form>
{/if}

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

  .ck-form__audio {
    display: flex;
    flex-direction: column;
    gap: var(--ck-space-1);
  }

  .ck-form__audio-label {
    font-size: var(--ck-font-size-sm);
    color: var(--ck-color-text-muted);
  }

  .ck-form__audio audio {
    width: 100%;
  }

  .ck-form__html-body {
    display: flex;
    flex-direction: column;
    gap: var(--ck-space-2);
  }

  /* :global -- this styles markup injected via {@html htmlBody}, which the
     Svelte compiler can't see statically, so it would otherwise flag these
     as unused selectors. */
  .ck-form__html-body :global(input),
  .ck-form__html-body :global(select),
  .ck-form__html-body :global(textarea) {
    border: 1px solid var(--ck-color-border);
    border-radius: var(--ck-radius-sm);
    padding: var(--ck-space-2);
    font-size: var(--ck-font-size-base);
    background: var(--ck-color-bg);
    color: var(--ck-color-text);
  }

  .ck-form__html-submit {
    align-self: flex-start;
    background: var(--ck-color-accent);
    color: var(--ck-color-accent-contrast);
    border: none;
    border-radius: var(--ck-radius-sm);
    padding: var(--ck-space-2) var(--ck-space-4);
    cursor: pointer;
  }

  .ck-form__html-result {
    display: flex;
    flex-direction: column;
    gap: var(--ck-space-2);
  }

  .ck-form__html-result-values {
    margin: 0;
    padding: var(--ck-space-2);
    border: 1px solid var(--ck-color-border);
    border-radius: var(--ck-radius-sm);
    background: var(--ck-color-surface);
    font-size: var(--ck-font-size-sm);
    overflow: auto;
  }

  .ck-form__radio-group,
  .ck-form__checkbox-group {
    display: flex;
    flex-direction: column;
    gap: var(--ck-space-1);
  }

  .ck-form__radio-option,
  .ck-form__checkbox-option {
    display: flex;
    align-items: center;
    gap: var(--ck-space-2);
    font-size: var(--ck-font-size-base);
    color: var(--ck-color-text);
  }

  .ck-form__grade {
    font-size: var(--ck-font-size-sm);
  }

  .ck-form__grade--correct {
    color: var(--ck-color-success, #16a34a);
  }

  .ck-form__grade--incorrect {
    color: var(--ck-color-error);
  }

  .ck-form__score {
    font-weight: 600;
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
