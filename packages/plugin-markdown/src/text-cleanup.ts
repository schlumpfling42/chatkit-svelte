/**
 * Small models write things a chat window has no business showing raw: LaTeX arrows (`$\rightarrow$`), HTML
 * entities (`&amp;`, `&nbsp;`), `<br>`, and backslash-escaped markdown (`\*`). This turns them into what the
 * writer meant, as plain text. It is deliberately not a LaTeX renderer: only the everyday symbols and simple
 * scripts are converted, and anything it does not fully understand is left exactly as written.
 */

/** Sentinel for a hard line break (`<br>`): U+2028 never appears in normal text, and the parser splits on it. */
export const LINE_BREAK = ' ';

const SYMBOLS: Record<string, string> = {
  // arrows
  rightarrow: '→', to: '→', longrightarrow: '⟶', leftarrow: '←', gets: '←', longleftarrow: '⟵',
  leftrightarrow: '↔', Rightarrow: '⇒', Leftarrow: '⇐', Leftrightarrow: '⇔', implies: '⇒', iff: '⇔',
  uparrow: '↑', downarrow: '↓', mapsto: '↦',
  // operators and relations
  times: '×', div: '÷', cdot: '·', pm: '±', mp: '∓', ast: '∗', star: '⋆', circ: '∘', bullet: '•',
  leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠', approx: '≈', sim: '∼', simeq: '≃', equiv: '≡',
  propto: '∝', ll: '≪', gg: '≫',
  // misc
  infty: '∞', degree: '°', ldots: '…', dots: '…', cdots: '⋯', checkmark: '✓',
  in: '∈', notin: '∉', subset: '⊂', subseteq: '⊆', supset: '⊃', cup: '∪', cap: '∩', emptyset: '∅',
  forall: '∀', exists: '∃', neg: '¬', land: '∧', lor: '∨', therefore: '∴', because: '∵',
  sum: '∑', prod: '∏', int: '∫', partial: '∂', nabla: '∇',
  // greek
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η',
  theta: 'θ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ',
  sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  // spacing
  quad: '  ', qquad: '    ',
};

/** The few symbols unambiguous enough to convert even without `$...$` around them (a bare `\to` could be a path). */
const BARE_SAFE = new Set(['rightarrow', 'leftarrow', 'leftrightarrow', 'Rightarrow', 'Leftarrow', 'times', 'approx', 'leq', 'geq', 'neq', 'infty']);

const SUPERSCRIPT: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ',
};

const SUBSCRIPT: Record<string, string> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
  '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎',
  a: 'ₐ', e: 'ₑ', h: 'ₕ', i: 'ᵢ', j: 'ⱼ', k: 'ₖ', l: 'ₗ', m: 'ₘ', n: 'ₙ', o: 'ₒ', p: 'ₚ', r: 'ᵣ', s: 'ₛ', t: 'ₜ', u: 'ᵤ', v: 'ᵥ', x: 'ₓ',
};

function toScript(inner: string, map: Record<string, string>, marker: string, braced: boolean, original: string): string {
  const normalized = inner.replace(/−/g, '-');
  const chars = [...normalized];
  if (chars.length > 0 && chars.every((c) => map[c] !== undefined)) return chars.map((c) => map[c]).join('');
  // Cannot be shown as real scripts: keep a braced group readable, and leave a lone unmappable character alone
  // (so `snake_case` inside \text{} is not mangled).
  return braced ? `${marker}(${inner})` : original;
}

function wrapIfCompound(part: string): string {
  return /^[\w.π]+$/.test(part) ? part : `(${part})`;
}

/**
 * The plain-text reading of a LaTeX fragment, or null if it uses anything not understood (in which case the
 * caller leaves the original text alone rather than showing a half-converted mess).
 */
export function latexToText(source: string): string | null {
  let s = source;
  s = s.replace(/\\(?:text|textbf|textit|mathrm|mathbf|mathit|mathsf|operatorname|mbox)\s*\{([^{}]*)\}/g, '$1');
  s = s.replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, (_m, a: string, b: string) => `${wrapIfCompound(a)}/${wrapIfCompound(b)}`);
  s = s.replace(/\\sqrt\s*\{([^{}]*)\}/g, (_m, x: string) => (x.length === 1 ? `√${x}` : `√(${x})`));
  s = s.replace(/\\([%$&#_{}])/g, '$1');
  s = s.replace(/\\!/g, '').replace(/\\[,;: ]/g, ' ');
  s = s.replace(/\\\\/g, ' ');
  s = s.replace(/\\([A-Za-z]+)/g, (m, name: string) => SYMBOLS[name] ?? m);
  s = s.replace(/\^\{([^{}]*)\}|\^([A-Za-z0-9+\-=()])/g, (m, braced: string | undefined, single: string | undefined) =>
    toScript(braced ?? single ?? '', SUPERSCRIPT, '^', braced !== undefined, m)
  );
  s = s.replace(/_\{([^{}]*)\}|_([A-Za-z0-9+\-=()])/g, (m, braced: string | undefined, single: string | undefined) =>
    toScript(braced ?? single ?? '', SUBSCRIPT, '_', braced !== undefined, m)
  );
  s = s.replace(/[{}]/g, '');
  if (/\\[A-Za-z]/.test(s)) return null;
  return s.trim();
}

// `$$..$$`, `$..$` (with the TeX rule that the opening `$` is followed, and the closing one preceded, by
// non-space, and the closing one is not followed by a digit: "$5 and $10" is money, not math), `\(..\)`, `\[..\]`.
const MATH_SPAN = /\$\$([^$]+?)\$\$|(?<!\\)\$(?!\s)([^$\n]*?[^\s$\\])\$(?!\d)|\\\(([^\n]+?)\\\)|\\\[([^\n]+?)\\\]/g;

function looksLikeMath(inner: string, delimited: 'dollar' | 'tex'): boolean {
  if (delimited === 'tex') return true; // \( \) and \[ \] are unambiguous
  return /[\\^_]/.test(inner) || /^[A-Za-z]{1,2}\d*$/.test(inner.trim());
}

function convertMath(text: string): string {
  return text.replace(MATH_SPAN, (whole, display: string | undefined, inline: string | undefined, paren: string | undefined, bracket: string | undefined) => {
    const inner = display ?? inline ?? paren ?? bracket ?? '';
    const converted = looksLikeMath(inner, display !== undefined || inline !== undefined ? 'dollar' : 'tex') ? latexToText(inner) : null;
    return converted ?? whole;
  });
}

function convertBareSymbols(text: string): string {
  return text.replace(/\\([A-Za-z]+)/g, (m, name: string) => (BARE_SAFE.has(name) ? SYMBOLS[name] : m));
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', rarr: '→', larr: '←',
  harr: '↔', times: '×', divide: '÷', plusmn: '±', deg: '°', copy: '©', reg: '®', trade: '™', laquo: '«', raquo: '»',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', bull: '•', middot: '·', euro: '€', pound: '£', yen: '¥', cent: '¢',
  le: '≤', ge: '≥', ne: '≠', infin: '∞',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(?:#(\d+)|#x([0-9a-fA-F]+)|([A-Za-z][A-Za-z0-9]*));/g, (whole, dec: string | undefined, hex: string | undefined, name: string | undefined) => {
    if (dec !== undefined || hex !== undefined) {
      const code = dec !== undefined ? Number.parseInt(dec, 10) : Number.parseInt(hex as string, 16);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[name as string] ?? whole;
  });
}

function convertTags(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, LINE_BREAK)
    .replace(/<(b|strong)>(.+?)<\/\1>/gi, '**$2**')
    .replace(/<(i|em)>(.+?)<\/\1>/gi, '*$2*')
    .replace(/<(del|s|strike)>(.+?)<\/\1>/gi, '~~$2~~')
    .replace(/<code>(.+?)<\/code>/gi, '`$1`')
    .replace(/<sup>(.+?)<\/sup>/gi, (m, x: string) => toScript(x, SUPERSCRIPT, '^', true, m))
    .replace(/<sub>(.+?)<\/sub>/gi, (m, x: string) => toScript(x, SUBSCRIPT, '_', true, m))
    .replace(/<\/?u>/gi, '');
}

/** Backslash-escaped characters are stashed behind private-use placeholders so markdown parsing cannot see them. */
const ESCAPABLE = /\\([\\`*_{}[\]()#+\-.!|~>$<&])/g;
const PLACEHOLDER_BASE = 0xe000;
const PLACEHOLDER = /[-]/g;

export interface PreparedInline {
  text: string;
  /** Characters the placeholders stand for. */
  stash: string[];
}

/** Everything that must happen to a run of prose before markdown parsing. Code spans are left untouched. */
export function prepareInline(text: string): PreparedInline {
  const stash: string[] = [];
  const parts = text.split(/(`[^`\n]*`)/);
  const prepared = parts
    .map((part, index) => {
      if (index % 2 === 1) return part; // a code span, verbatim
      let s = convertMath(part);
      s = convertBareSymbols(s);
      s = convertTags(s);
      s = decodeEntities(s);
      return s.replace(ESCAPABLE, (_m, ch: string) => {
        stash.push(ch);
        return String.fromCharCode(PLACEHOLDER_BASE + stash.length - 1);
      });
    })
    .join('');
  return { text: prepared, stash };
}

export function restoreEscapes(text: string, stash: string[]): string {
  if (stash.length === 0) return text;
  return text.replace(PLACEHOLDER, (ch) => stash[ch.charCodeAt(0) - PLACEHOLDER_BASE] ?? ch);
}
