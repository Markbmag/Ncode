import { Flex } from '@chakra-ui/react';
import { engineMeta } from '../lib/engines';

interface EngineBadgeProps {
  engine: string;
  size?: number;
}

export function EngineBadge({ engine, size = 32 }: EngineBadgeProps) {
  const meta = engineMeta(engine);
  return (
    <Flex
      w={`${size}px`}
      h={`${size}px`}
      flexShrink={0}
      align="center"
      justify="center"
      borderRadius="lg"
      bg={meta.color}
      color="white"
      fontWeight={700}
      fontSize={`${Math.round(size * 0.38)}px`}
      letterSpacing="-0.02em"
      boxShadow="inset 0 0 0 1px rgba(255,255,255,0.18)"
      aria-label={meta.label}
    >
      {meta.short}
    </Flex>
  );
}
