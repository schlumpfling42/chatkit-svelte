import { describe, expect, it } from 'vitest';
import { createScrollFollower, followTarget, isAtBottom } from '../src/scroll-follow';

describe('followTarget', () => {
  const view = { clientHeight: 400, scrollTop: 0 };

  it('goes to the bottom while the answer is short enough that the question stays in view', () => {
    // 1000px of content in a 400px window: the bottom is at scrollTop 600; the question (at 700) is still below the top.
    expect(followTarget({ ...view, scrollHeight: 1000, questionOffset: 700 })).toBe(600);
  });

  it('stops where the question reaches the top, however much more is written', () => {
    expect(followTarget({ ...view, scrollHeight: 2000, questionOffset: 300 })).toBe(300);
    expect(followTarget({ ...view, scrollHeight: 9000, questionOffset: 300 })).toBe(300);
  });

  it('follows the bottom when there is no question to keep in view', () => {
    expect(followTarget({ ...view, scrollHeight: 1000, questionOffset: null })).toBe(600);
  });

  it('never scrolls up: a reader who is already past the question is left alone', () => {
    expect(followTarget({ clientHeight: 400, scrollTop: 800, scrollHeight: 3000, questionOffset: 300 })).toBeNull();
  });

  it('does nothing when it is already where it should be', () => {
    expect(followTarget({ clientHeight: 400, scrollTop: 600, scrollHeight: 1000, questionOffset: null })).toBeNull();
    expect(followTarget({ clientHeight: 400, scrollTop: 300, scrollHeight: 2000, questionOffset: 300 })).toBeNull();
  });

  it('does nothing while everything fits on screen', () => {
    expect(followTarget({ clientHeight: 400, scrollTop: 0, scrollHeight: 300, questionOffset: null })).toBeNull();
    expect(followTarget({ clientHeight: 400, scrollTop: 0, scrollHeight: 400, questionOffset: 0 })).toBeNull();
  });

  it('never asks for a negative position', () => {
    expect(followTarget({ clientHeight: 400, scrollTop: 0, scrollHeight: 2000, questionOffset: -20 })).toBeNull();
  });
});

describe('isAtBottom', () => {
  it('is true within a few pixels of the end, false further up', () => {
    expect(isAtBottom({ clientHeight: 400, scrollTop: 600, scrollHeight: 1000, questionOffset: null })).toBe(true);
    expect(isAtBottom({ clientHeight: 400, scrollTop: 595, scrollHeight: 1000, questionOffset: null })).toBe(true);
    expect(isAtBottom({ clientHeight: 400, scrollTop: 500, scrollHeight: 1000, questionOffset: null })).toBe(false);
  });

  it('counts a list that fits on screen as being at the bottom', () => {
    expect(isAtBottom({ clientHeight: 400, scrollTop: 0, scrollHeight: 300, questionOffset: null })).toBe(true);
  });
});

/** The bits of a scrolling element the follower touches, with a clock the test controls. */
class FakeScroller extends EventTarget {
  scrollTop = 0;
  clientHeight = 400;
  clientWidth = 300; // the scrollbar sits to the right of this
  scrollHeight = 400;
  getBoundingClientRect() {
    return { left: 0 } as DOMRect;
  }
}

function setup(questionOffset: number | null = null) {
  const scroller = new FakeScroller();
  let now = 0;
  let question = questionOffset;
  const follower = createScrollFollower({
    scroller: scroller as unknown as HTMLElement,
    questionOffset: () => question,
    now: () => now,
  });
  return {
    scroller,
    follower,
    setQuestion: (offset: number | null) => (question = offset),
    advance: (ms: number) => (now += ms),
    grow: (to: number) => {
      scroller.scrollHeight = to;
      follower.follow();
    },
  };
}

function scrollBarClick(scroller: FakeScroller, clientX: number) {
  scroller.dispatchEvent(new MouseEvent('pointerdown', { clientX }));
}

describe('createScrollFollower', () => {
  it('keeps the newest output in view as the content grows', () => {
    const { scroller, grow } = setup();

    grow(600);
    expect(scroller.scrollTop).toBe(200);
    grow(900);
    expect(scroller.scrollTop).toBe(500);
  });

  it('stops following once the question has reached the top', () => {
    const { scroller, grow } = setup(350);

    grow(500);
    expect(scroller.scrollTop).toBe(100); // still following the bottom
    grow(800);
    expect(scroller.scrollTop).toBe(350); // the question is now at the top
    grow(3000);
    expect(scroller.scrollTop).toBe(350); // and stays there while the answer keeps growing
  });

  it('lets go the moment the wheel turns', () => {
    const { scroller, grow } = setup();
    grow(800);
    expect(scroller.scrollTop).toBe(400);

    scroller.dispatchEvent(new Event('wheel'));
    grow(1500);

    expect(scroller.scrollTop).toBe(400);
  });

  it('lets go when a finger drags the list', () => {
    const { scroller, grow } = setup();
    grow(800);

    scroller.dispatchEvent(new Event('touchmove'));
    grow(1500);

    expect(scroller.scrollTop).toBe(400);
  });

  it('lets go on the keys that scroll, and only those', () => {
    for (const key of ['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown', ' ']) {
      const { scroller, grow } = setup();
      grow(800);
      scroller.dispatchEvent(new KeyboardEvent('keydown', { key }));
      grow(1500);
      expect(scroller.scrollTop, key).toBe(400);
    }

    const { scroller, grow } = setup();
    grow(800);
    scroller.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    grow(1500);
    expect(scroller.scrollTop).toBe(1100);
  });

  it('lets go when the scrollbar is grabbed, but not when the text is clicked', () => {
    const clickedText = setup();
    clickedText.grow(800);
    scrollBarClick(clickedText.scroller, 100);
    clickedText.grow(1500);
    expect(clickedText.scroller.scrollTop).toBe(1100);

    const grabbedBar = setup();
    grabbedBar.grow(800);
    scrollBarClick(grabbedBar.scroller, 310);
    grabbedBar.grow(1500);
    expect(grabbedBar.scroller.scrollTop).toBe(400);
  });

  it('follows again when the reader scrolls back down to the end', () => {
    const { scroller, follower, grow, advance } = setup();
    grow(800);
    scroller.dispatchEvent(new Event('wheel'));
    scroller.scrollTop = 100;
    scroller.dispatchEvent(new Event('scroll'));
    advance(50);
    grow(1200);
    expect(scroller.scrollTop).toBe(100); // still reading up there

    advance(50);
    scroller.scrollTop = 800; // the very end of 1200 - 400
    scroller.dispatchEvent(new Event('scroll'));
    expect(follower.following).toBe(true);
    grow(1600);
    expect(scroller.scrollTop).toBe(1200);
  });

  it('does not treat a scroll that nobody asked for as the reader coming back', () => {
    const { scroller, follower, grow, advance } = setup();
    grow(800);
    scroller.dispatchEvent(new Event('wheel'));
    advance(5000); // long after the last input

    scroller.scrollTop = 400;
    scroller.dispatchEvent(new Event('scroll'));

    expect(follower.following).toBe(false);
  });

  it('follows again for a new question', () => {
    const { scroller, follower, grow, setQuestion } = setup();
    grow(800);
    scroller.dispatchEvent(new Event('wheel'));
    grow(1500);
    expect(scroller.scrollTop).toBe(400);

    setQuestion(1400);
    follower.newQuestion();

    expect(follower.following).toBe(true);
    expect(scroller.scrollTop).toBe(1100); // the end of 1500 - 400, with the new question still below the top
  });

  it('opens at the bottom', () => {
    const { scroller, follower } = setup(200);
    scroller.scrollHeight = 5000;

    follower.jumpToBottom();

    expect(scroller.scrollTop).toBe(4600);
  });

  it('stays with the end of a conversation it just opened while the content settles or an answer is still arriving', () => {
    // The last question is far above: holding "at the question" would mean not moving at all.
    const { scroller, follower, grow } = setup(200);
    scroller.scrollHeight = 5000;
    follower.jumpToBottom();

    grow(5300); // late layout, or a run that was still going when the page opened
    expect(scroller.scrollTop).toBe(4900);
    grow(6000);
    expect(scroller.scrollTop).toBe(5600);
  });

  it('lets the reader leave a just-opened conversation by scrolling', () => {
    const { scroller, follower, grow } = setup(200);
    scroller.scrollHeight = 5000;
    follower.jumpToBottom();

    scroller.dispatchEvent(new Event('wheel'));
    grow(6000);

    expect(scroller.scrollTop).toBe(4600);
  });

  it('goes back to holding at the question once a new one is asked', () => {
    const { scroller, follower, grow, setQuestion } = setup(200);
    scroller.scrollHeight = 5000;
    follower.jumpToBottom();

    setQuestion(5200);
    scroller.scrollHeight = 5600;
    follower.newQuestion();
    expect(scroller.scrollTop).toBe(5200); // the end of 5600 - 400, which is also where the question sits
    grow(9000);

    expect(scroller.scrollTop).toBe(5200);
  });

  it('stops listening once destroyed', () => {
    const { scroller, follower, grow } = setup();
    follower.destroy();
    scroller.dispatchEvent(new Event('wheel'));
    follower.follow();
    grow(800);

    // destroyed followers do nothing at all, not even follow
    expect(scroller.scrollTop).toBe(0);
  });
});
