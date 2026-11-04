/**
 * The app's hover hint: Chakra's Tooltip that waits 3 seconds before it shows (Mark's request: hints
 * that popped up at once flickered while the mouse moved across buttons). Every screen imports
 * Tooltip from here, so the delay is the same everywhere; a hint closes when the button is pressed.
 */
import { Tooltip as ChakraTooltip, type TooltipProps } from '@chakra-ui/react';

export const HINT_DELAY_MS = 3000;

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- openDelay is taken out so one delay applies
export function Tooltip({ openDelay: _ignored, ...props }: TooltipProps) {
  return <ChakraTooltip openDelay={HINT_DELAY_MS} closeOnPointerDown closeOnScroll {...props} />;
}
