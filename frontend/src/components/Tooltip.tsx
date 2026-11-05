/**
 * The app's hover hint: Chakra's Tooltip that waits 3 seconds before it shows (Mark's request: hints
 * that popped up at once flickered while the mouse moved across buttons). Every screen imports
 * Tooltip from here, so the rules are the same everywhere:
 *
 * - it opens when the mouse rests on the button, or when someone moves to it with the keyboard (Tab);
 * - it does NOT open just because the button got focus otherwise: after a menu or window closes the
 *   browser puts focus back on the button that opened it, and a tap on a phone focuses the button -
 *   both made hints pop up "by themselves" (Mark, after K2);
 * - it closes when the button is pressed or the page scrolls.
 */
import { cloneElement, isValidElement } from 'react';
import type { FocusEvent, ReactElement } from 'react';
import { Tooltip as ChakraTooltip, type TooltipProps } from '@chakra-ui/react';

export const HINT_DELAY_MS = 3000;

// What the person used last: the keyboard (Tab, arrows) or a mouse / finger.
let usingKeyboard = false;
if (typeof document !== 'undefined') {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' || e.key.startsWith('Arrow')) usingKeyboard = true;
  }, true);
  document.addEventListener('pointerdown', () => (usingKeyboard = false), true);
}

type FocusHandler = (e: FocusEvent<HTMLElement>) => void;

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- openDelay is taken out so one delay applies
export function Tooltip({ openDelay: _ignored, children, ...props }: TooltipProps) {
  // Chakra runs the button's own onFocus first and skips opening when it calls preventDefault()
  const trigger = isValidElement(children)
    ? cloneElement(children as ReactElement<{ onFocus?: FocusHandler }>, {
        onFocus: (e: FocusEvent<HTMLElement>) => {
          (children as ReactElement<{ onFocus?: FocusHandler }>).props.onFocus?.(e);
          if (!usingKeyboard) e.preventDefault();
        },
      })
    : children;
  return (
    <ChakraTooltip openDelay={HINT_DELAY_MS} closeOnPointerDown closeOnScroll {...props}>
      {trigger}
    </ChakraTooltip>
  );
}
