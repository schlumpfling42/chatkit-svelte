// Scrolling behaviour of a chat transcript while an answer streams in:
//
//   * keep the newest output in view,
//   * until the question that is being answered reaches the top of the window (from there on the answer keeps
//     growing below it and the question stays put),
//   * and the moment the reader scrolls, stop moving the page for them.
//
// The decision is a pure function so it can be tested without layout; the follower wires it to a real element.

export interface ScrollGeometry {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
  /**
   * The scrollTop at which the question being answered sits at the top edge of the window, or null when there is
   * none to keep in view (no question yet, or the app renders messages its own way).
   */
  questionOffset: number | null;
}

/** Nearer than this to the end counts as "at the bottom" (sub-pixel layout and fractional scroll positions). */
const BOTTOM_TOLERANCE_PX = 8;
/** Below this a move is not worth making (avoids fighting fractional scroll positions). */
const MIN_MOVE_PX = 0.5;
/** A scroll this soon after the reader last touched the list is the reader's own (momentum scrolling included). */
const USER_SCROLL_WINDOW_MS = 1000;

const SCROLL_KEYS = new Set(['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown', ' ']);

/**
 * Where the list should be scrolled to, or null to leave it alone. Never scrolls upward: a reader who is already
 * past the question is not pulled back to it.
 */
export function followTarget(geometry: ScrollGeometry): number | null {
  const bottom = Math.max(0, geometry.scrollHeight - geometry.clientHeight);
  const target = geometry.questionOffset === null ? bottom : Math.min(bottom, Math.max(0, geometry.questionOffset));
  return target > geometry.scrollTop + MIN_MOVE_PX ? target : null;
}

export function isAtBottom(geometry: ScrollGeometry): boolean {
  return geometry.scrollHeight - geometry.clientHeight - geometry.scrollTop <= BOTTOM_TOLERANCE_PX;
}

export interface ScrollFollowerOptions {
  scroller: HTMLElement;
  /** See {@link ScrollGeometry.questionOffset}; called whenever the follower has to decide. */
  questionOffset: () => number | null;
  /** For tests. */
  now?: () => number;
}

export interface ScrollFollower {
  /** Call whenever the content may have grown. Does nothing once the reader has taken over. */
  follow(): void;
  /** A new question was asked: follow again, whatever the reader did before. */
  newQuestion(): void;
  /** Open at the very end, and stay with it (settling layout, an answer still arriving) until the reader scrolls or asks. */
  jumpToBottom(): void;
  readonly following: boolean;
  destroy(): void;
}

export function createScrollFollower(options: ScrollFollowerOptions): ScrollFollower {
  const { scroller } = options;
  const now = options.now ?? (() => Date.now());
  let following = true;
  // Set when a conversation is opened: until the reader scrolls or asks something, stay with the very end, ignoring
  // the question (which is most likely far above, and holding "at the question" would then mean not moving at all).
  let pinnedToEnd = false;
  let lastUserInputAt = Number.NEGATIVE_INFINITY;
  let destroyed = false;

  function geometry(): ScrollGeometry {
    return {
      scrollTop: scroller.scrollTop,
      clientHeight: scroller.clientHeight,
      scrollHeight: scroller.scrollHeight,
      questionOffset: pinnedToEnd ? null : options.questionOffset(),
    };
  }

  function follow(): void {
    if (destroyed || !following) return;
    const target = followTarget(geometry());
    if (target !== null) scroller.scrollTop = target;
  }

  // Programmatic scrolls also raise `scroll` events, so the reader is recognised by their input, not by scrolling:
  // wheel, touch, the scrolling keys, and a grab of the scrollbar.
  function readerTookOver(): void {
    following = false;
    pinnedToEnd = false;
    lastUserInputAt = now();
  }

  function onKeyDown(event: Event): void {
    if (SCROLL_KEYS.has((event as KeyboardEvent).key)) readerTookOver();
  }

  function onPointerDown(event: Event): void {
    const scrollbarStart = scroller.getBoundingClientRect().left + scroller.clientWidth;
    if ((event as MouseEvent).clientX > scrollbarStart) readerTookOver();
  }

  // Reading back down to the end hands control back: what is being written is right there again.
  function onScroll(): void {
    if (destroyed || following) return;
    if (now() - lastUserInputAt < USER_SCROLL_WINDOW_MS && isAtBottom(geometry())) following = true;
  }

  scroller.addEventListener('wheel', readerTookOver, { passive: true });
  scroller.addEventListener('touchmove', readerTookOver, { passive: true });
  scroller.addEventListener('keydown', onKeyDown);
  scroller.addEventListener('pointerdown', onPointerDown);
  scroller.addEventListener('scroll', onScroll, { passive: true });

  return {
    follow,
    newQuestion() {
      if (destroyed) return;
      following = true;
      pinnedToEnd = false;
      follow();
    },
    jumpToBottom() {
      if (destroyed) return;
      following = true;
      pinnedToEnd = true;
      scroller.scrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    },
    get following() {
      return following;
    },
    destroy() {
      destroyed = true;
      scroller.removeEventListener('wheel', readerTookOver);
      scroller.removeEventListener('touchmove', readerTookOver);
      scroller.removeEventListener('keydown', onKeyDown);
      scroller.removeEventListener('pointerdown', onPointerDown);
      scroller.removeEventListener('scroll', onScroll);
    },
  };
}
