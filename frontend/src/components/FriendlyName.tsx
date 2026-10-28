import { Box, Text, Tooltip } from '@chakra-ui/react';
import type { TextProps } from '@chakra-ui/react';

interface FriendlyNameProps {
  label: string;               // the data model's name in the UI language (lib/names.ts)
  name: string;                // the technical name
  description?: string | null; // shown as a tooltip
  showTechnical?: boolean;     // the label hides the technical name: show it small and muted
  mono?: boolean;              // no friendly name: the technical name in a monospace font (Browse)
  stacked?: boolean;           // technical name under the label instead of next to it
  fontSize?: TextProps['fontSize'];
  fontWeight?: TextProps['fontWeight'];
}

/** A table or column by its friendly name (M11), the technical name small next to it, the description on hover. */
export function FriendlyName({ label, name, description, showTechnical = false, mono = false, stacked = false, fontSize, fontWeight }: FriendlyNameProps) {
  const plain = !showTechnical && mono;
  return (
    <Tooltip label={description} isDisabled={!description} hasArrow openDelay={400} placement="right">
      <Box as="span" display="flex" flexDirection={stacked ? 'column' : 'row'} alignItems={stacked ? 'flex-start' : 'baseline'} columnGap={1.5} minW={0}>
        <Text as="span" noOfLines={1} fontFamily={plain ? 'mono' : undefined} fontSize={fontSize} fontWeight={fontWeight}>
          {plain ? name : label}
        </Text>
        {showTechnical && (
          <Text as="span" fontFamily="mono" fontSize="xs" color="faintText" fontWeight={400} noOfLines={1}>
            {name}
          </Text>
        )}
      </Box>
    </Tooltip>
  );
}
