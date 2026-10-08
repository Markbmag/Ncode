import { Box } from '@chakra-ui/react';
import type { MatchMode } from '../api';
import { splitByMatch } from '../lib/match';

interface HighlightProps {
  text: string;
  phrase: string;
  mode: MatchMode;
  caseSensitive: boolean;
}

/** Renders `text` with the parts that matched the search phrase marked. */
export function Highlight({ text, phrase, mode, caseSensitive }: HighlightProps) {
  const segments = splitByMatch(text, phrase, mode, caseSensitive);
  return (
    <>
      {segments.map((segment, index) =>
        segment.match ? (
          <Box as="mark" key={index} bg="matchBg" color="matchText" borderRadius="sm" px="2px" mx="-2px">
            {segment.text}
          </Box>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}
